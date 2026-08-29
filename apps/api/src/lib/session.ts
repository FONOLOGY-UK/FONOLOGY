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
   * Present only for staff. Round 5 Phase 2 #4 — the staff member's own
   * auto-lock override, in minutes; null means "use the shop default"
   * (`shop_settings.idle_lock_minutes`). Undefined for a customer session.
   */
  idleLockMinutes?: number | null;
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

    const { staffSessionId } = readCookies(req);
    let locked = false;
    if (staffSessionId) {
      const { data: sessionRow } = await supabaseAdmin
        .from('staff_sessions')
        .select('locked')
        .eq('id', staffSessionId)
        .eq('staff_id', staffRow.id)
        .is('ended_at', null)
        .maybeSingle();
      locked = sessionRow?.locked ?? false;
    }

    return {
      id: staffRow.id,
      name: staffRow.name,
      email: staffRow.email,
      kind: 'staff',
      staffRole: staffRow.role,
      permissions,
      staffSessionId: staffSessionId ?? undefined,
      locked,
      idleLockMinutes: staffRow.idle_lock_minutes ?? null,
    };
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
