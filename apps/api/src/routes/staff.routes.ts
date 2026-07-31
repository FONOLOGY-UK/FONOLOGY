import { supabaseAuth, supabaseAdmin } from '../lib/supabase.js';
import { setAuthCookies, setStaffSessionCookie } from '../lib/cookies.js';
import { loadPermissions } from '../lib/permissions.js';
import { hashPin, verifyPin } from '../lib/password.js';
import { unlockBackoffMs } from '../lib/backoff.js';
import { requireStaff, requireUnlocked } from '../middleware/auth.js';
import { signInBodySchema, pinBodySchema, unlockBodySchema } from '../schemas.js';

import { createRouter } from '../lib/router.js';

export const staffRouter = createRouter();

/**
 * Staff sign-in — a separate route from customer sign-in, even though both
 * go through the same underlying Supabase Auth. After password auth
 * succeeds, this enforces the staff-specific rules the ground rules ask for:
 * the account must have a `staff` row, and it must be active. An inactive
 * staff member is refused here even though their password is correct.
 */
staffRouter.post('/signin', async (req, res) => {
  const parsed = signInBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { email, password } = parsed.data;

  const signIn = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session || !signIn.data.user) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const { data: staffRow } = await supabaseAdmin
    .from('staff')
    .select('id, name, email, role, is_active')
    .eq('id', signIn.data.user.id)
    .maybeSingle();

  if (!staffRow) {
    return res.status(403).json({ error: 'No staff account for that email.' });
  }
  if (!staffRow.is_active) {
    return res.status(403).json({ error: 'That staff account is deactivated.' });
  }

  setAuthCookies(res, signIn.data.session.access_token, signIn.data.session.refresh_token);

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

  setStaffSessionCookie(res, staffSessionId);

  const permissions = await loadPermissions(staffRow.id);

  return res.json({
    id: staffRow.id,
    name: staffRow.name,
    email: staffRow.email,
    kind: 'staff',
    staffRole: staffRow.role,
    permissions,
    staffSessionId,
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
