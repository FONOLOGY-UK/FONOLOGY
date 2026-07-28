import { supabaseAdmin } from './supabase.js';

/**
 * Mirrors `public.permission` (0002_identity.sql) exactly. This app enforces
 * permissions itself against `staff_permissions` — RLS on that table denies
 * everything (see 0011_security.sql); it is a backstop, not the gate.
 */
export const PERMISSIONS = [
  'pos.operate',
  'jobs.manage',
  'inventory.manage',
  'promotions.manage',
  'cash.manage',
  'tradein.manage',
  'sales.today',
  'costs.view',
  'analytics.view',
  'payments.view',
  'reports.view',
  'returns.manage',
  'labels.manage',
  'staff.manage',
  'settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Loads a staff member's real, per-person granted permission set. */
export async function loadPermissions(staffId: string): Promise<Permission[]> {
  const { data, error } = await supabaseAdmin
    .from('staff_permissions')
    .select('permission')
    .eq('staff_id', staffId);

  if (error) throw error;
  return (data ?? []).map((row) => row.permission as Permission);
}

/**
 * Single-permission check, mirroring the schema's own `staff_can()` SQL
 * function (staff must be active, and hold the permission). Used at
 * individual protected actions; `loadPermissions` is used for session
 * hydration (bulk-loading the set once, not calling this in a loop).
 */
export async function staffCan(staffId: string, permission: Permission): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('staff_can', {
    p_staff_id: staffId,
    p_permission: permission,
  });
  if (error) throw error;
  return Boolean(data);
}
