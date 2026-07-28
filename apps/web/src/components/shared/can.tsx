'use client';

import type { ReactNode } from 'react';
import { useSession } from '@/lib/data/hooks';
import type { StaffRole } from '@/lib/data/types';
import { can, type Permission } from '@/lib/permissions.config';

/**
 * Permission guards (item 8). All decisions flow from permissions.config.ts —
 * these components never encode role logic themselves.
 */

/**
 * The viewer's staff role. Falls back per surface while auth is mock-only:
 * the admin assumes an owner, the employee panel assumes counter staff — so
 * both panels are demonstrable without signing in, and a real staff session
 * (item 9's staff login) takes over the moment it exists.
 */
export function useStaffRole(fallback: StaffRole): StaffRole {
  const { data: session } = useSession();
  if (session?.kind === 'staff' && session.staffRole) return session.staffRole;
  return fallback;
}

/**
 * The signed-in staff member's REAL, per-person permission set
 * (`session.permissions`) — `null` when there's no staff session yet (mock
 * mode, or still loading), in which case `can()` falls back to the coarser
 * role map. Prefer this over `useStaffRole` wherever a permission decision
 * is being made, not just a role-flavoured default.
 */
export function useStaffPermissions(): Permission[] | null {
  const { data: session } = useSession();
  return session?.kind === 'staff' ? session.permissions : null;
}

/** Render children only when the viewer holds `permission` — real per-person set first, `role` as fallback. */
export function Can({
  role,
  do: permission,
  fallback = null,
  children,
}: {
  role: StaffRole;
  do: Permission;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const permissions = useStaffPermissions();
  return can(role, permission, permissions) ? <>{children}</> : <>{fallback}</>;
}
