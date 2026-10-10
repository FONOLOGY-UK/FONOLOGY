import type { Response } from 'express';
import { attempt, db } from '../lib/db.js';
import { readCookies, setSessionCookie, setStaffSessionCookie } from '../lib/cookies.js';
import { checkAccountPassword, findAccountByEmail, normaliseEmail } from '../lib/accounts.js';
import { createAuthSession, revokeAuthSession } from '../lib/authSessions.js';
import { loadPermissions } from '../lib/permissions.js';
import { staffAuthUser, type StaffAuthRow } from '../lib/session.js';
import { clientIp } from '../lib/clientIp.js';
import { hashPin, verifyPin } from '../lib/password.js';
import { beginPinAttempt, endPinAttempt, pinLimits } from '../lib/pinGuard.js';
import { isRateLimited, resetRateLimit } from '../lib/rateLimit.js';
import { requireStaff } from '../middleware/auth.js';
import {
  signInBodySchema,
  pinBodySchema,
  unlockBodySchema,
  idleLockBodySchema,
  staffSwitchBodySchema,
} from '../schemas.js';

import { createRouter } from '../lib/router.js';
import { isUuid } from '../lib/uuid.js';

export const staffRouter = createRouter();

/**
 * Staff sign-in — a separate route from customer sign-in, even though both
 * use the same `user_accounts` password check. After password auth
 * succeeds, this enforces the staff-specific rules the ground rules ask for:
 * the account must have a `staff` row, and it must be active. An inactive
 * staff member is refused here even though their password is correct.
 *
 * Readiness-audit Group 2: this endpoint gates the till, customer data and
 * payment operations, so it's the strictest of the three login surfaces —
 * 5 attempts per 15 minutes, keyed by IP+email so one leaked/guessed
 * password can't be brute-forced from a single machine, and a flood aimed
 * at many accounts from one IP doesn't exhaust a single shared bucket
 * either. Recorded via `isRateLimited` BEFORE the outcome is known (so the
 * current attempt always counts against the cap and a caller can never
 * squeeze in one more try than the limit allows); a genuine success then
 * clears the bucket via `resetRateLimit` so it's failures, not a raw
 * request count, that actually consumes the allowance in the normal case.
 */
staffRouter.post('/signin', async (req, res) => {
  const parsed = signInBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { email, password } = parsed.data;

  const rateLimitKey = `staff-signin:${clientIp(req) ?? 'unknown'}:${normaliseEmail(email)}`;
  if (isRateLimited(rateLimitKey, { max: 5, windowMs: 15 * 60_000 })) {
    return res
      .status(429)
      .json({ error: 'Too many sign-in attempts. Please try again in a few minutes.' });
  }

  const account = await findAccountByEmail(email);
  // Checked even when no account matched, so both cost the same time.
  const passwordOk = await checkAccountPassword(account, password);
  if (!account || !passwordOk) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  resetRateLimit(rateLimitKey);

  const staffRow = await db
    .selectFrom('staff')
    .select(['id', 'name', 'email', 'role', 'is_active', 'idle_lock_minutes', 'shop_id'])
    .where('id', '=', account.id)
    .executeTakeFirst();

  if (!staffRow) {
    return res.status(403).json({ error: 'No staff account for that email.' });
  }
  if (!staffRow.is_active) {
    return res.status(403).json({ error: 'That staff account is deactivated.' });
  }

  setSessionCookie(req, res, await createAuthSession(account.id, req.get('user-agent')));

  // A till session belongs to a DEVICE, not to a person. The browser holds its
  // staff_sessions id in a cookie; signing in again on the same device picks that
  // row back up (same person, still open, not a PIN-switched till row). Any other
  // device — including a second one signed in as the same person — gets its own
  // row, so locking one till never locks the others.
  //
  // NEVER A pos_only ROW. A PIN switch (0089) gives the till its own row for the
  // incoming person, marked pos_only. Reusing that row here would hand the till,
  // unlocked on four digits, the whole admin surface. The till's row keeps its
  // restriction; a password sign-in reuses only a password session, or starts one.
  const deviceCookie = readCookies(req).staffSessionId;
  const openSession = isUuid(deviceCookie)
    ? await db
        .selectFrom('staff_sessions')
        .select('id')
        .where('id', '=', deviceCookie)
        .where('staff_id', '=', staffRow.id)
        .where('ended_at', 'is', null)
        .where('pos_only', '=', false)
        .executeTakeFirst()
    : undefined;

  let staffSessionId = openSession?.id;
  if (!staffSessionId) {
    const { data: created, error: createError } = await attempt(() =>
      db
        .insertInto('staff_sessions')
        .values({ staff_id: staffRow.id })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    if (createError) {
      return res.status(500).json({ error: 'Could not start a staff session.' });
    }
    staffSessionId = created.id;
  } else {
    // A password sign-in is BY DEFINITION not a till-PIN session, and the
    // row picked above is never a pos_only one — so there is no flag to
    // clear here. (There once was: this route landed on the PIN-switched row
    // and cleared it, which fixed "catalogue not loading in the till" by
    // opening Admin to the till. See the comment on the query above.)
    await db
      .updateTable('staff_sessions')
      .set({ last_active_at: new Date().toISOString() })
      .where('id', '=', staffSessionId)
      .execute()
      .catch(() => undefined);
  }

  setStaffSessionCookie(req, res, staffSessionId);

  const permissions = await loadPermissions(staffRow.id);

  return res.json(staffAuthUser(staffRow, permissions, { staffSessionId }));
});

/** Sets (or changes) the caller's own PIN. Hashed immediately — never logged raw. */
staffRouter.post('/pin', requireStaff, async (req, res) => {
  const parsed = pinBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const pinHash = await hashPin(parsed.data.pin);
  const { error } = await attempt(() =>
    db.updateTable('staff').set({ pin_hash: pinHash }).where('id', '=', req.user!.id).execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not set PIN.' });
  return res.status(204).end();
});

/**
 * Sets (or clears) the caller's own auto-lock override (Round 5 Phase 2
 * #4). `.eq('id', req.user!.id)` is load-bearing, not a style choice — the
 * request body carries no staff id at all, so there is no field a caller
 * could tamper with to target anyone else's row; this is the entire
 * server-side enforcement that a staff member can only ever change their
 * own auto-lock, matching exactly how POST /pin already works above.
 */
staffRouter.post('/me/idle-lock', requireStaff, async (req, res) => {
  const parsed = idleLockBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const { error } = await attempt(() =>
    db
      .updateTable('staff')
      .set({ idle_lock_minutes: parsed.data.idleLockMinutes })
      .where('id', '=', req.user!.id)
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not save your auto-lock setting.' });
  return res.status(204).end();
});

/** Locks the current device's staff_sessions row. Server-side — a reload cannot undo this. */
staffRouter.post('/session/lock', requireStaff, async (req, res) => {
  if (!req.user!.staffSessionId) {
    return res.status(400).json({ error: 'No active staff session to lock.' });
  }
  const staffSessionId = req.user!.staffSessionId;
  const { error } = await attempt(() =>
    db
      .updateTable('staff_sessions')
      .set({ locked: true, last_active_at: new Date().toISOString() })
      .where('id', '=', staffSessionId)
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not lock session.' });
  return res.status(204).end();
});

/**
 * Replaces an old bcrypt PIN hash with argon2id once the right PIN has been seen. Best effort: a failure
 * to upgrade must never fail an unlock or a switch that already succeeded.
 */
async function upgradePinHash(staffId: string, pin: string): Promise<void> {
  await db
    .updateTable('staff')
    .set({ pin_hash: await hashPin(pin) })
    .where('id', '=', staffId)
    .execute()
    .catch((err) => {
      console.error('[auth] could not upgrade a bcrypt PIN hash for', staffId, err);
    });
}

/** The 429 a locked-out PIN attempt gets. Same wording for a wrong PIN, an unset PIN or an unknown account. */
function pinLockedResponse(res: Response, waitMs: number) {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  res.setHeader('Retry-After', String(seconds));
  return res.status(429).json({
    error: `Too many wrong PINs. Wait ${seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds}s`} and try again.`,
  });
}

/** Unlocks the current device's staff_sessions row — only with the right PIN. */
staffRouter.post('/session/unlock', requireStaff, async (req, res) => {
  const parsed = unlockBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  if (!req.user!.staffSessionId) {
    return res.status(400).json({ error: 'No active staff session to unlock.' });
  }
  const sessionId = req.user!.staffSessionId;

  // Charged BEFORE the PIN is checked (see lib/pinGuard.ts), so parallel guesses cannot out-run it.
  const limits = pinLimits({ session: sessionId, account: req.user!.id, ip: clientIp(req) });
  const wait = beginPinAttempt(limits);
  if (wait > 0) return pinLockedResponse(res, wait);

  const staffRow = await db
    .selectFrom('staff')
    .select('pin_hash')
    .where('id', '=', req.user!.id)
    .executeTakeFirst();

  // A staff member with no PIN set fails exactly like a wrong PIN — same
  // status, same message. Nothing here tells a caller whether the
  // PIN was wrong, unset, or the account odd in some other way.
  const verdict = staffRow?.pin_hash
    ? await verifyPin(parsed.data.pin, staffRow.pin_hash)
    : { ok: false, needsRehash: false };
  endPinAttempt(limits, verdict.ok);
  if (!verdict.ok) return res.status(401).json({ error: 'Incorrect PIN.' });
  if (verdict.needsRehash) void upgradePinHash(req.user!.id, parsed.data.pin);

  const { error } = await attempt(() =>
    db
      .updateTable('staff_sessions')
      .set({ locked: false, last_active_at: new Date().toISOString() })
      .where('id', '=', sessionId)
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not unlock session.' });
  return res.status(204).end();
});

/* ---------------------------------------------------------------------- */
/* Fast PIN switching at the till (change request item 4)                   */
/* ---------------------------------------------------------------------- */

/**
 * Who can be switched into from this lock screen.
 *
 * `requireStaff` WITHOUT `requireUnlocked`, deliberately: the caller is by
 * definition looking at a locked till, so anything gated on being unlocked
 * would be unreachable from the one screen that needs it.
 *
 * Only id and name, only active staff, and only people who actually hold
 * `pos.operate`. Offering an account that would be refused a moment later
 * is how a staff member concludes their PIN is broken. Nothing here reveals
 * an email, a role or a permission set — it is the list of names already
 * written on the rota by the door.
 */
staffRouter.get('/switchable', requireStaff, async (req, res) => {
  const { data: rows, error } = await attempt(() =>
    db
      .selectFrom('staff')
      .select(['id', 'name'])
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('staff_permissions')
            .select('staff_id')
            .whereRef('staff_permissions.staff_id', '=', 'staff.id')
            .where('staff_permissions.permission', '=', 'pos.operate'),
        ),
      )
      .where('is_active', '=', true)
      .where('pin_hash', 'is not', null)
      // A till stays in its shop: you can only switch to someone who works there.
      .$if(!!req.user!.shopId, (qb) => qb.where('shop_id', '=', req.user!.shopId!))
      .orderBy('name')
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load the staff list.' });

  return res.json(rows.map((r) => ({ id: r.id, name: r.name })));
});

/**
 * Switch the till to another member of staff on their own 4-digit PIN.
 *
 * WHAT THIS ACTUALLY DOES, because "switch accounts" hides a real change:
 * the outgoing person's session is ENDED and their sign-in session revoked,
 * and a genuine session is minted for the incoming person. Their
 * requests are theirs from that moment — same identity resolution, same
 * permission load, same everything as a password sign-in. Attribution stays
 * unambiguous, which is the entire reason not to "park" the first session:
 * two live sessions on one device is how a sale ends up recorded against
 * whoever happened to be dormant.
 *
 * The cost, accepted deliberately: a half-built ticket on screen is
 * discarded when the account changes.
 *
 * THE NEW SESSION IS MARKED pos_only, AND THAT IS THE SECURITY RESTRICTION.
 * Four digits is not an email and a password, so the session it buys is not
 * worth as much: `blockPosOnlySession` refuses the whole admin surface for
 * it regardless of permissions, and an owner who switches in this way gets
 * the till until they sign in properly. See 0089 for why the marker cannot
 * be shed by deleting a cookie.
 *
 * A WRONG PIN IS ANSWERED EXACTLY LIKE AN UNKNOWN ACCOUNT — same status,
 * same message, same escalating delay — so this cannot be used to find out
 * who works here or who has a PIN set. Same rule the unlock route follows.
 */
staffRouter.post('/session/switch', requireStaff, async (req, res) => {
  const parsed = staffSwitchBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { staffId, pin } = parsed.data;

  // Charged BEFORE the PIN is checked, to the caller's session AND to the account being tried (and the
  // IP): one session cannot walk the whole staff list, and several sessions cannot share one account's
  // budget. See lib/pinGuard.ts.
  const limits = pinLimits({
    session: req.user!.staffSessionId ?? clientIp(req) ?? 'unknown',
    account: staffId,
    ip: clientIp(req),
  });
  const wait = beginPinAttempt(limits);
  if (wait > 0) return pinLockedResponse(res, wait);

  const target = await db
    .selectFrom('staff')
    // `role` and `idle_lock_minutes` are here because the RESPONSE needs
    // them, not the PIN check: staffAuthUser() builds the whole contract and
    // the web schema requires `staffRole`. Selecting only what the check
    // needed is what left it out and broke item 4.
    .select([
      'id',
      'email',
      'name',
      'role',
      'is_active',
      'pin_hash',
      'idle_lock_minutes',
      'shop_id',
    ])
    .where('id', '=', staffId)
    .executeTakeFirst();

  const permissions = target ? await loadPermissions(target.id) : [];

  // Narrowed to a single truthy check rather than a chain of non-null
  // assertions, so the PIN comparison below cannot be reached with a null
  // hash — an unknown account and a wrong PIN then fall through the same
  // branch, which is exactly the indistinguishability this route needs.
  const pinHash =
    target &&
    target.is_active === true &&
    target.pin_hash &&
    permissions.includes('pos.operate') &&
    (!req.user!.shopId || target.shop_id === req.user!.shopId)
      ? target.pin_hash
      : null;

  const verdict =
    pinHash !== null ? await verifyPin(pin, pinHash) : { ok: false, needsRehash: false };
  endPinAttempt(limits, verdict.ok);
  if (!verdict.ok) return res.status(401).json({ error: 'Incorrect PIN.' });
  if (verdict.needsRehash) void upgradePinHash(staffId, pin);

  /*
   * ORDER MATTERS, and the obvious order is the wrong one.
   *
   * The incoming person's session row is created FIRST; the outgoing
   * person's is ended only once that has succeeded. Written the other way
   * round — end, then create — a failure on the create leaves NOBODY signed
   * in on a live till, which is the one outcome worse than the switch not
   * working. Found exactly that way while verifying this against a database
   * that did not yet have 0089: the insert failed, the outgoing session was
   * already gone, and the next request 401'd.
   *
   * The failure mode of this order is a second live row if the end fails,
   * which is harmless: only one of them is in a cookie. There is no sweep
   * that closes it later (an earlier version of this comment said there
   * was) — an open row nobody holds a cookie for grants nothing, and
   * /staff/signin never reuses a pos_only row, so it is clutter, not access.
   */
  const { data: created, error: createErr } = await attempt(() =>
    db
      .insertInto('staff_sessions')
      .values({ staff_id: target!.id, pos_only: true })
      .returning('id')
      .executeTakeFirstOrThrow(),
  );
  if (createErr) {
    return res.status(500).json({ error: 'Could not start a session for that account.' });
  }

  // The incoming person's sign-in session, minted directly — the same kind
  // of row a password sign-in creates, so nothing downstream needs a special
  // case. Only the pos_only marker on the staff_sessions row above differs.
  const { data: sessionToken, error: sessionErr } = await attempt(() =>
    createAuthSession(target!.id, req.get('user-agent')),
  );
  if (sessionErr) {
    return res.status(500).json({ error: 'Could not start a session for that account.' });
  }

  const outgoingSessionId = req.user!.staffSessionId;
  if (outgoingSessionId) {
    await db
      .updateTable('staff_sessions')
      .set({ ended_at: new Date().toISOString() })
      .where('id', '=', outgoingSessionId)
      .execute()
      .catch(() => undefined);
  }
  await revokeAuthSession(readCookies(req).sessionToken).catch(() => undefined);

  setSessionCookie(req, res, sessionToken);
  setStaffSessionCookie(req, res, created.id);

  return res.json(
    staffAuthUser(target as unknown as StaffAuthRow, permissions, {
      staffSessionId: created.id,
      posOnly: true,
    }),
  );
});
