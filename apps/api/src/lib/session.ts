import type { Request, Response } from 'express';
import { supabaseAuth, supabaseAdmin } from './supabase.js';
import { loadPermissions, type Permission } from './permissions.js';
import { readCookies, setAuthCookies } from './cookies.js';

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
 * Verifies the access-token cookie against Supabase Auth, transparently
 * refreshing it once via the refresh-token cookie if it's expired, then
 * resolves whether the underlying auth.users id is a customer or staff
 * member. Returns null for no session / invalid session — never throws for
 * that case, so callers can treat "no session" as an ordinary, expected
 * outcome.
 */
export async function resolveSession(req: Request, res: Response): Promise<ApiAuthUser | null> {
  const { accessToken, refreshToken } = readCookies(req);
  if (!accessToken) return null;

  let userId: string | null = null;
  let userEmail: string | null = null;

  const first = await supabaseAuth.auth.getUser(accessToken);
  if (first.data.user) {
    userId = first.data.user.id;
    userEmail = first.data.user.email ?? null;
  } else if (refreshToken) {
    // Access token expired — try the refresh token once before giving up.
    const refreshed = await supabaseAuth.auth.refreshSession({ refresh_token: refreshToken });
    if (refreshed.data.session && refreshed.data.user) {
      userId = refreshed.data.user.id;
      userEmail = refreshed.data.user.email ?? null;
      setAuthCookies(
        req,
        res,
        refreshed.data.session.access_token,
        refreshed.data.session.refresh_token,
      );
    }
  }

  if (!userId || !userEmail) return null;

  // Staff first — an account is either staff or a customer, never both in
  // practice (see report), and staff identity is the more privileged one to
  // get right.
  const { data: staffRow } = await supabaseAdmin
    .from('staff')
    .select('id, name, email, role, is_active, idle_lock_minutes')
    .eq('id', userId)
    .maybeSingle();

  if (staffRow) {
    if (!staffRow.is_active) return null; // deactivated — no session, full stop
    const permissions = await loadPermissions(staffRow.id);

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
     *   2. The PIN LOCK lives on this row too, and always has — so deleting
     *      that one cookie already lifted a locked till. That is the exact
     *      thing the lock's own comment claims is impossible ("reloading the
     *      page, opening a new tab, or clearing local storage cannot lift
     *      it"), and it was true of everything except the cookie itself.
     *
     * Both now fail the same way: no live row, no session. Logged out is the
     * safe direction, and the normal path is unaffected — every sign-in
     * creates a row, and this cookie and the refresh cookie share a 30-day
     * life so they expire together.
     */
    const { staffSessionId } = readCookies(req);
    if (!staffSessionId) return null;

    /*
     * `select('*')`, not a named column list, and that is load-bearing
     * rather than lazy. `pos_only` arrives with 0089, and PostgREST fails
     * the WHOLE query when a named column does not exist — so a named list
     * here would make every staff request resolve to no session and 401 the
     * entire back office until the migration landed. Found exactly that way:
     * a staff sign-in returned 200 and the very next request 401'd.
     *
     * A star select returns whatever the table has, so the API keeps working
     * either side of the migration and `pos_only` simply reads undefined
     * until the column exists — which defaults to false below, the correct
     * value for a world in which PIN switching cannot happen yet.
     */
    const { data: sessionRow } = await supabaseAdmin
      .from('staff_sessions')
      .select('*')
      .eq('id', staffSessionId)
      .eq('staff_id', staffRow.id)
      .is('ended_at', null)
      .maybeSingle();
    if (!sessionRow) return null;

    const locked = (sessionRow.locked as boolean | null) ?? false;
    // Defaults false rather than being required, so the API still resolves
    // sessions on a database where 0089 has not been applied yet.
    const posOnly = ((sessionRow as Record<string, unknown>).pos_only as boolean | null) ?? false;

    return staffAuthUser(staffRow, permissions, {
      staffSessionId,
      locked,
      posOnly,
    });
  }

  const { data: customerRow } = await supabaseAdmin
    .from('customers')
    .select('id, name, email')
    .eq('id', userId)
    .maybeSingle();

  if (customerRow) {
    return {
      id: customerRow.id,
      name: customerRow.name,
      email: customerRow.email,
      kind: 'customer',
      staffRole: null,
      permissions: null,
    };
  }

  return null;
}
