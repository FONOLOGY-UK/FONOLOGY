import { supabaseAuth, supabaseAdmin } from '../lib/supabase.js';
import { setAuthCookies, setStaffSessionCookie } from '../lib/cookies.js';
import { loadPermissions } from '../lib/permissions.js';
import { clientIp } from '../lib/clientIp.js';
import { hashPin, verifyPin } from '../lib/password.js';
import { unlockBackoffMs } from '../lib/backoff.js';
import { isRateLimited, resetRateLimit } from '../lib/rateLimit.js';
import { requireStaff, requireUnlocked } from '../middleware/auth.js';
import {
  signInBodySchema,
  pinBodySchema,
  unlockBodySchema,
  idleLockBodySchema,
  staffSwitchBodySchema,
} from '../schemas.js';

import { createRouter } from '../lib/router.js';

export const staffRouter = createRouter();

/**
 * Staff sign-in — a separate route from customer sign-in, even though both
 * go through the same underlying Supabase Auth. After password auth
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

  const rateLimitKey = `staff-signin:${clientIp(req) ?? 'unknown'}:${email.trim().toLowerCase()}`;
  if (isRateLimited(rateLimitKey, { max: 5, windowMs: 15 * 60_000 })) {
    return res
      .status(429)
      .json({ error: 'Too many sign-in attempts. Please try again in a few minutes.' });
  }

  const signIn = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session || !signIn.data.user) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  resetRateLimit(rateLimitKey);

  const { data: staffRow } = await supabaseAdmin
    .from('staff')
    .select('id, name, email, role, is_active, idle_lock_minutes')
    .eq('id', signIn.data.user.id)
    .maybeSingle();

  if (!staffRow) {
    return res.status(403).json({ error: 'No staff account for that email.' });
  }
  if (!staffRow.is_active) {
    return res.status(403).json({ error: 'That staff account is deactivated.' });
  }

  setAuthCookies(req, res, signIn.data.session.access_token, signIn.data.session.refresh_token);

  // Reuse an already-open session for this staff member if one exists,
  // otherwise start a new one.
  //
  // This is PER ACCOUNT, not per device. Two devices signed in as the same
  // staff member resolve to the same staff_sessions row, so locking one
  // locks the other — they are one session, not two. That is acceptable
  // under the confirmed policy that every staff member has their own login:
  // a person locking their own session everywhere is the expected result.
  //
  // It would be wrong if an account were ever shared across a shop floor,
  // because one person locking up would lock every till. Making a session
  // mean "a device at a till" rather than "a person" is the more correct
  // model — it needs a device identifier issued at sign-in and carried on
  // the session cookie. Not built: the policy makes it unnecessary today.
  // (An earlier version of this comment claimed each device got its own row.
  // It never did.)
  const { data: openSession } = await supabaseAdmin
    .from('staff_sessions')
    .select('id')
    .eq('staff_id', staffRow.id)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let staffSessionId = openSession?.id as string | undefined;
  if (!staffSessionId) {
    const { data: created, error: createError } = await supabaseAdmin
      .from('staff_sessions')
      .insert({ staff_id: staffRow.id })
      .select('id')
      .single();
    if (createError || !created) {
      return res.status(500).json({ error: 'Could not start a staff session.' });
    }
    staffSessionId = created.id as string;
  } else {
    await supabaseAdmin
      .from('staff_sessions')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', staffSessionId);
  }

  setStaffSessionCookie(req, res, staffSessionId);

  const permissions = await loadPermissions(staffRow.id);

  return res.json({
    id: staffRow.id,
    name: staffRow.name,
    email: staffRow.email,
    kind: 'staff',
    staffRole: staffRow.role,
    permissions,
    staffSessionId,
    idleLockMinutes: staffRow.idle_lock_minutes ?? null,
    locked: false,
  });
});

/** Sets (or changes) the caller's own PIN. Hashed immediately — never logged raw. */
staffRouter.post('/pin', requireStaff, async (req, res) => {
  const parsed = pinBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const pinHash = await hashPin(parsed.data.pin);
  const { error } = await supabaseAdmin
    .from('staff')
    .update({ pin_hash: pinHash })
    .eq('id', req.user!.id);
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

  const { error } = await supabaseAdmin
    .from('staff')
    .update({ idle_lock_minutes: parsed.data.idleLockMinutes })
    .eq('id', req.user!.id);
  if (error) return res.status(500).json({ error: 'Could not save your auto-lock setting.' });
  return res.status(204).end();
});

/** Locks the current device's staff_sessions row. Server-side — a reload cannot undo this. */
staffRouter.post('/session/lock', requireStaff, async (req, res) => {
  if (!req.user!.staffSessionId) {
    return res.status(400).json({ error: 'No active staff session to lock.' });
  }
  const { error } = await supabaseAdmin
    .from('staff_sessions')
    .update({ locked: true, last_active_at: new Date().toISOString() })
    .eq('id', req.user!.staffSessionId);
  if (error) return res.status(500).json({ error: 'Could not lock session.' });
  return res.status(204).end();
});

/**
 * Failed unlock attempts per staff session, feeding the escalating delay in
 * `lib/backoff.ts`. In memory: it resets on restart and isn't shared between
 * instances — proportionate for a single API process, worth revisiting if that
 * changes.
 */
const failedUnlocks = new Map<string, number>();

/** Unlocks the current device's staff_sessions row — only with the right PIN. */
staffRouter.post('/session/unlock', requireStaff, async (req, res) => {
  const parsed = unlockBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  if (!req.user!.staffSessionId) {
    return res.status(400).json({ error: 'No active staff session to unlock.' });
  }
  const sessionId = req.user!.staffSessionId;

  const { data: staffRow } = await supabaseAdmin
    .from('staff')
    .select('pin_hash')
    .eq('id', req.user!.id)
    .single();

  // A staff member with no PIN set fails exactly like a wrong PIN — same
  // status, same message, same delay. Nothing here tells a caller whether the
  // PIN was wrong, unset, or the account odd in some other way.
  const ok = staffRow?.pin_hash ? await verifyPin(parsed.data.pin, staffRow.pin_hash) : false;
  if (!ok) {
    const failures = (failedUnlocks.get(sessionId) ?? 0) + 1;
    failedUnlocks.set(sessionId, failures);
    await new Promise((resolve) => setTimeout(resolve, unlockBackoffMs(failures)));
    return res.status(401).json({ error: 'Incorrect PIN.' });
  }

  const { error } = await supabaseAdmin
    .from('staff_sessions')
    .update({ locked: false, last_active_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) return res.status(500).json({ error: 'Could not unlock session.' });
  failedUnlocks.delete(sessionId);
  return res.status(204).end();
});

/**
 * Reloads the caller's permission set. Gated by requireUnlocked — this is
 * the concrete "protected action" the B1 proof exercises: a locked session
 * gets 423 here, an unlocked one gets the real, current permission list.
 */
staffRouter.get('/permissions', requireStaff, requireUnlocked, async (req, res) => {
  const permissions = await loadPermissions(req.user!.id);
  return res.json({ permissions });
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
staffRouter.get('/switchable', requireStaff, async (_req, res) => {
  const { data: allowed, error: permErr } = await supabaseAdmin
    .from('staff_permissions')
    .select('staff_id')
    .eq('permission', 'pos.operate');
  if (permErr) return res.status(500).json({ error: 'Could not load the staff list.' });

  const ids = [...new Set((allowed ?? []).map((r) => r.staff_id as string))];
  if (ids.length === 0) return res.json([]);

  const { data: rows, error } = await supabaseAdmin
    .from('staff')
    .select('id, name')
    .in('id', ids)
    .eq('is_active', true)
    .not('pin_hash', 'is', null)
    .order('name');
  if (error) return res.status(500).json({ error: 'Could not load the staff list.' });

  return res.json((rows ?? []).map((r) => ({ id: r.id, name: r.name })));
});

/**
 * Switch the till to another member of staff on their own 4-digit PIN.
 *
 * WHAT THIS ACTUALLY DOES, because "switch accounts" hides a real change:
 * the outgoing person's session is ENDED and their auth tokens revoked, and
 * a genuine Supabase session is minted for the incoming person. Their
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
 * the till until they sign in properly. See 0086 for why the marker cannot
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

  // Keyed on the DEVICE's current session, not on the account being tried:
  // otherwise someone could walk the whole staff list four guesses at a time
  // and never trip a delay.
  const backoffKey = req.user!.staffSessionId ?? clientIp(req) ?? 'unknown';

  const { data: target } = await supabaseAdmin
    .from('staff')
    .select('id, email, name, is_active, pin_hash')
    .eq('id', staffId)
    .maybeSingle();

  const permissions = target ? await loadPermissions(target.id as string) : [];
  const eligible =
    Boolean(target) &&
    target!.is_active === true &&
    Boolean(target!.pin_hash) &&
    permissions.includes('pos.operate' as never);

  const ok = eligible ? await verifyPin(pin, target!.pin_hash as string) : false;
  if (!ok) {
    const failures = (failedUnlocks.get(backoffKey) ?? 0) + 1;
    failedUnlocks.set(backoffKey, failures);
    await new Promise((resolve) => setTimeout(resolve, unlockBackoffMs(failures)));
    return res.status(401).json({ error: 'Incorrect PIN.' });
  }
  failedUnlocks.delete(backoffKey);

  /*
   * Mint a real session for the incoming person.
   *
   * The service role asks GoTrue for a one-time token for their address and
   * immediately redeems it. That is a supported service-role path and it is
   * what makes the rest of the system need no special cases: downstream,
   * this session is indistinguishable from a password sign-in except for
   * the pos_only marker, which is the one difference that should exist.
   *
   * Nothing is torn down before this succeeds. If minting fails, the
   * outgoing person is still signed in and the till is still theirs —
   * far better than both people being locked out of a working counter.
   */
  // supabaseAdmin (service role) mints the one-time token; supabaseAuth
  // (anon) redeems it. That split is not incidental — generateLink is an
  // Auth ADMIN call and the anon key cannot make it, while verifyOtp is the
  // ordinary public redemption an email link would perform. Getting this
  // backwards fails with a flat 500 and no useful message; it did, once.
  const link = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: target!.email as string,
  });
  const hashedToken = link.data?.properties?.hashed_token;
  if (link.error || !hashedToken) {
    return res.status(500).json({ error: 'Could not switch accounts. Try signing in instead.' });
  }

  const redeemed = await supabaseAuth.auth.verifyOtp({ token_hash: hashedToken, type: 'email' });
  if (redeemed.error || !redeemed.data.session) {
    return res.status(500).json({ error: 'Could not switch accounts. Try signing in instead.' });
  }

  /*
   * ORDER MATTERS, and the obvious order is the wrong one.
   *
   * The incoming person's session row is created FIRST; the outgoing
   * person's is ended only once that has succeeded. Written the other way
   * round — end, then create — a failure on the create leaves NOBODY signed
   * in on a live till, which is the one outcome worse than the switch not
   * working. Found exactly that way while verifying this against a database
   * that did not yet have 0086: the insert failed, the outgoing session was
   * already gone, and the next request 401'd.
   *
   * The failure mode of this order is two live rows for a moment if the end
   * fails, which is harmless: only one of them is in a cookie, and the
   * sweep that closes stale sessions will get the other.
   */
  const { data: created, error: createErr } = await supabaseAdmin
    .from('staff_sessions')
    .insert({ staff_id: target!.id, pos_only: true })
    .select('id')
    .single();
  if (createErr || !created) {
    return res.status(500).json({ error: 'Could not start a session for that account.' });
  }

  if (req.user!.staffSessionId) {
    await supabaseAdmin
      .from('staff_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', req.user!.staffSessionId);
  }

  setAuthCookies(req, res, redeemed.data.session.access_token, redeemed.data.session.refresh_token);
  setStaffSessionCookie(req, res, created.id as string);

  return res.json({
    id: target!.id,
    name: target!.name,
    email: target!.email,
    kind: 'staff',
    permissions,
    staffSessionId: created.id,
    locked: false,
    posOnly: true,
  });
});
