import crypto from 'node:crypto';
import { attempt, db, sql } from '../../lib/db.js';
import { isUuid } from '../../lib/uuid.js';
import { hashPassword } from '../../lib/password.js';
import { normaliseEmail } from '../../lib/accounts.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { staffCreateBodySchema, staffUpdateBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';

export const adminStaffRouter = createRouter();
const router = adminStaffRouter;

/* ---------------------------------------------------------------------- */
/* Staff — create (default template), edit permissions, deactivate, PIN     */
/* ---------------------------------------------------------------------- */

async function toApiStaff(row: Record<string, unknown>) {
  const perms = await db
    .selectFrom('staff_permissions')
    .select('permission')
    .where('staff_id', '=', row.id as string)
    .execute();
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    // `active` — matches apps/web's Staff field name exactly (not `isActive`,
    // which is what this project's convention elsewhere uses).
    active: row.is_active,
    startedAt: row.created_at ? (row.created_at as string).slice(0, 10) : null,
    // The real per-person grants. Extra keys are silently stripped by a
    // non-strict zod .parse(), so this doesn't break staffSchema validation.
    permissions: perms.map((p) => p.permission),
    createdAt: row.created_at,
  };
}

router.get('/staff', requireStaff, requirePermission('staff.manage'), async (_req, res) => {
  const data = await db.selectFrom('staff').selectAll().orderBy('name').execute();
  return res.json(await Promise.all(data.map(toApiStaff)));
});

/** Creates the sign-in account (user_accounts) AND the staff row, in one transaction. The role sets the DEFAULT template (apply_default_permissions trigger) — per-person changes have no endpoint or screen yet (replace_staff_permissions() in 0077 is the DB side). */
router.post('/staff', requireStaff, requirePermission('staff.manage'), async (req, res) => {
  const parsed = staffCreateBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  // A temporary password is generated when none is given, returned ONCE below
  // so the owner can hand it to the new starter (same "returned once, never
  // logged" pattern as the sell-request acceptance token).
  const tempPassword = body.password ?? crypto.randomBytes(12).toString('base64url');

  // Created already confirmed: the owner is vouching for the address, and a
  // new starter's sign-in must not wait on an email arriving.
  const email = normaliseEmail(body.email);
  const passwordHash = await hashPassword(tempPassword);
  const { data: row, error } = await attempt(() =>
    db.transaction().execute(async (trx) => {
      const account = await trx
        .insertInto('user_accounts')
        .values({ email, password_hash: passwordHash, email_verified_at: sql`now()` })
        .returning('id')
        .executeTakeFirstOrThrow();
      return trx
        .insertInto('staff')
        .values({
          id: account.id,
          email,
          name: body.name,
          role: body.role,
          phone: body.phone ?? null,
          is_active: body.active ?? true,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }),
  );
  if (error) {
    if (error.code === '23505' && /user_accounts/.test(error.message + (error.details ?? ''))) {
      return res.status(400).json({ error: 'An account with that email already exists.' });
    }
    return res.status(400).json({ error: error.message });
  }
  return res.status(201).json({
    ...(await toApiStaff(row)),
    ...(body.password ? {} : { temporaryPassword: tempPassword }),
  });
});

/**
 * Independent audit finding HIGH-03: nothing stopped the shop locking
 * itself out of its own staff administration.
 *
 * `staff.manage` is the permission that gates every route able to grant
 * permissions — including this one. Remove it from the last active person
 * holding it (by revoking it, or by deactivating them) and there is no
 * longer anyone who can give it back. There is no break-glass path in the
 * app: recovery means someone with the service-role key running SQL by
 * hand against the production database.
 *
 * That is a live risk here rather than a theoretical one. The shop has a
 * handful of staff and, realistically, one owner, who administers his own
 * account from the same dashboard he sells from. "Untick the wrong box on
 * your own row" is an ordinary afternoon mistake, and its blast radius was
 * permanent.
 *
 * The invariant enforced is deliberately the weakest one that holds: AT
 * LEAST ONE ACTIVE STAFF MEMBER HOLDS `staff.manage`. Not "the owner may
 * not edit himself" — handing over to a new owner and standing yourself
 * down is a legitimate thing to do, and works fine as long as the new
 * owner has the permission first. Role is not consulted at all: `role` is
 * only the template applied at creation (0002), so demoting an owner to
 * employee changes nothing about what they can actually do.
 *
 * Enforced here rather than as a database trigger on purpose. A trigger
 * would also block the direct-SQL repair that is the recovery path for an
 * account already stranded, which is the one moment it must not.
 */
const LOCKOUT_GUARD_PERMISSION = 'staff.manage';

/**
 * Active holders of staff.manage. Joined on staff_permissions.staff_id
 * explicitly — the table has a second FK to staff (granted_by), and joining
 * on the wrong one once silently disabled this entire guard.
 */
function activeAdmins() {
  return db
    .selectFrom('staff_permissions')
    .innerJoin('staff', 'staff.id', 'staff_permissions.staff_id')
    .select('staff_permissions.staff_id')
    .where('staff_permissions.permission', '=', LOCKOUT_GUARD_PERMISSION)
    .where('staff.is_active', '=', true);
}

/** Is there an active staff member OTHER than `excludingStaffId` holding staff.manage? */
async function anotherActiveAdminExists(excludingStaffId: string): Promise<boolean> {
  // Fail CLOSED: if this check can't be answered, refuse the edit rather
  // than allow the one that might be unrecoverable.
  if (!isUuid(excludingStaffId)) return false;
  try {
    const row = await activeAdmins()
      .where('staff_permissions.staff_id', '<>', excludingStaffId)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  } catch {
    return false;
  }
}

/**
 * Does this staff member currently hold staff.manage, and are they active?
 *
 * Fails CLOSED in the opposite direction to the helper above — an
 * unanswerable check is treated as "yes, they are an admin", so the guard
 * still engages rather than waving the edit through. The two together mean
 * a broken query refuses the edit instead of silently permitting the one
 * change that cannot be undone.
 */
async function isActiveAdmin(staffId: string): Promise<boolean> {
  if (!isUuid(staffId)) return true;
  try {
    const row = await activeAdmins()
      .where('staff_permissions.staff_id', '=', staffId)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  } catch {
    return true;
  }
}

const LOCKOUT_MESSAGE =
  'This would leave the shop with no active staff member who can manage staff. Give someone else staff management access first, then make this change.';

router.put('/staff/:id', requireStaff, requirePermission('staff.manage'), async (req, res) => {
  const parsed = staffUpdateBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;
  const patch: {
    name?: string;
    role?: 'owner' | 'employee';
    phone?: string;
    is_active?: boolean;
  } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.role !== undefined) patch.role = body.role; // does NOT re-apply the default template — matches "role is only the starting template"
  if (body.phone !== undefined) patch.phone = body.phone;
  // apps/web sends `active`; `isActive` stays accepted for older callers.
  const activeFlag = body.active ?? body.isActive;
  if (activeFlag !== undefined) patch.is_active = activeFlag;

  // Deactivating the last active staff.manage holder strands the shop.
  if (activeFlag === false && (await isActiveAdmin(req.params.id!))) {
    if (!(await anotherActiveAdminExists(req.params.id!))) {
      return res.status(409).json({ error: LOCKOUT_MESSAGE });
    }
  }

  const { data: row, error } = await attempt(() =>
    Object.keys(patch).length === 0
      ? db
          .selectFrom('staff')
          .selectAll()
          .where('id', '=', req.params.id ?? '')
          .executeTakeFirst()
      : db
          .updateTable('staff')
          .set(patch)
          .where('id', '=', req.params.id ?? '')
          .returningAll()
          .executeTakeFirst(),
  );
  if (error) return res.status(400).json({ error: error.message });
  if (!row) return res.status(404).json({ error: 'Staff member not found.' });
  return res.json(await toApiStaff(row));
});
