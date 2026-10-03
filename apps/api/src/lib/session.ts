import type { Request, Response } from 'express';
import { isUuid } from './uuid.js';
import type { Permission } from './permissions.js';
import { readCookies, setSessionCookie, setStaffSessionCookie } from './cookies.js';
import { findAuthPrincipal } from './authSessions.js';

/**
 * Matches `AuthUser` in apps/web/src/lib/data/types/auth.ts exactly, plus an
 * additive `permissions` field.
 *
 * `staffRole` is now the raw `staff_role` value. It used to be translated
 * (employee->counter) to satisfy a frontend enum that invented four roles;
 * that enum has been corrected to the two the database actually has, so the
 * translation is gone. It was never a safe fiction anyway: GET /admin/staff
 * returned the untranslated value, so the same field meant different things
 * on two endpoints.
 *
 * Role remains a coarse label. Enforcement always uses `permissions` — the
 * real per-person set from `staff_permissions` — on every server-side check.
 */
export interface ApiAuthUser {
  id: string;
  name: string;
  email: string;
  kind: 'customer' | 'staff';
  staffRole: 'owner' | 'employee' | null;
  permissions: Permission[] | null;
  /** Present only for staff — the staff_sessions row backing PIN-lock state. */
  staffSessionId?: string;
  locked?: boolean;
  /**
   * Change request item 4. True when this session came from a PIN switch at
   * the till rather than a full sign-in. The admin surface is refused
   * outright for these, whatever permissions the person holds.
   */
  posOnly?: boolean;
  /**
   * Present only for staff. Round 5 Phase 2 #4 — the staff member's own
   * auto-lock override, in minutes; null means "use the shop default"
   * (`shop_settings.idle_lock_minutes`). Undefined for a customer session.
   */
  idleLockMinutes?: number | null;
}

/** The columns every staff AuthUser is built from. */
export interface StaffAuthRow {
  id: string;
  name: string;
  email: string;
  role: string;
  idle_lock_minutes: number | null;
}

/**
 * THE one place a staff `ApiAuthUser` is shaped.
 *
 * It exists because there were three, written out by hand, and they drifted
 * — which is exactly how change request item 4 shipped broken.
 *
 * `POST /staff/session/switch` returned a body with no `staffRole`. On the
 * web side `authUserSchema` has that field REQUIRED (nullable, not
 * optional), so `authUserSchema.parse` threw on a response the server had
 * already fully acted on: the account was switched, both cookies were
 * rewritten, the outgoing session was ended. The adapter rejected, the
 * mutation's `onSuccess` never ran — so the cache was never cleared and the
 * page never reloaded — and the keypad's catch, seeing something that was
 * not an `ApiError`, told the person their PIN was wrong. It was not. The
 * till had already changed hands underneath a screen still showing the
 * previous name.
 *
 * Three fixes were attempted inside that `onSuccess` before anyone checked
 * whether it ran at all. It never did. A missing field on one of three
 * copies of one contract cost all of that, hence one copy from here on.
 *
 * TypeScript could not have caught it: nothing types the boundary between
 * this response and the Zod schema that parses it. The contract test in
 * apps/web/src/lib/data/types/auth-contract.test.ts is what does.
 */
export function staffAuthUser(
  staff: StaffAuthRow,
  permissions: Permission[],
  session: { staffSessionId: string; locked?: boolean; posOnly?: boolean },
): ApiAuthUser {
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    kind: 'staff',
    staffRole: staff.role as 'owner' | 'employee',
    permissions,
    staffSessionId: session.staffSessionId,
    locked: session.locked ?? false,
    posOnly: session.posOnly ?? false,
    idleLockMinutes: staff.idle_lock_minutes ?? null,
  };
}

/**
 * Resolves the `fnl_session` cookie to its account — ONE query (findAuthPrincipal)
 * covering the session, the staff or customer row, the permissions and the
 * till-lock row — then shapes it. Returns null for no session / invalid
 * session — never throws for that case, so callers can treat "no session" as
 * an ordinary, expected outcome.
 *
 * Sessions slide: at most once an hour a session in use has its expiry pushed
 * 30 days out and its cookies re-sent with a matching max-age, so a till in
 * daily use never signs itself out.
 */
export async function resolveSession(req: Request, res: Response): Promise<ApiAuthUser | null> {
  const { sessionToken, staffSessionId: staffCookie } = readCookies(req);
  const found = await findAuthPrincipal(sessionToken, isUuid(staffCookie) ? staffCookie : null);
  if (!found) return null;
  const { row, refreshed } = found;
  if (refreshed && sessionToken) {
    setSessionCookie(req, res, sessionToken);
    if (staffCookie) setStaffSessionCookie(req, res, staffCookie);
  }

  // Staff first — an account is either staff or a customer, never both in
  // practice, and staff identity is the more privileged one to get right.
  if (row.staff_id) {
    if (!row.staff_is_active) return null; // deactivated — no session, full stop

    /*
     * THE staff_sessions ROW IS MANDATORY (change request item 4).
     *
     * It did not used to be: a staff auth session with no cookie, or with a
     * cookie pointing at an ended row, simply resolved with locked = false.
     * Two things made that untenable:
     *
     *   1. `pos_only` lives on this row. A PIN-switched session that could
     *      shed its row could shed the one thing stopping it reaching Admin,
     *      which would make the doc's security restriction cosmetic.
     *
     *   2. The PIN LOCK lives on this row too — so deleting that one cookie
     *      would lift a locked till, which the lock's own comment claims is
     *      impossible.
     *
     * Both fail the same way: no live row, no session. Logged out is the safe
     * direction, and the normal path is unaffected — every sign-in creates a
     * row, and this cookie and the session cookie share a 30-day life and are
     * re-sent together, so they expire together.
     */
    if (!row.staff_session_found) return null;

    return staffAuthUser(
      {
        id: row.staff_id,
        name: row.staff_name!,
        email: row.staff_email!,
        role: row.staff_role!,
        idle_lock_minutes: row.staff_idle_lock_minutes,
      },
      (row.staff_permissions ?? []) as Permission[],
      {
        staffSessionId: staffCookie!,
        locked: row.staff_session_locked ?? false,
        posOnly: row.staff_session_pos_only ?? false,
      },
    );
  }

  if (row.customer_id) {
    return {
      id: row.customer_id,
      name: row.customer_name!,
      email: row.customer_email!,
      kind: 'customer',
      staffRole: null,
      permissions: null,
    };
  }

  return null;
}
