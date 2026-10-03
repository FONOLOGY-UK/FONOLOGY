'use client';

import { useSession } from '@/lib/data/hooks';
import type { StaffRole } from '@/lib/data/types';
import type { Permission } from '@/lib/permissions.config';

/**
 * Session-derived inputs to `can()` (permissions.config.ts). These hooks never
 * encode role logic themselves. What they gate is only what renders — the API
 * enforces every permission per person.
 */

/** The viewer's staff role, or `fallback` while there is no staff session yet. */
export function useStaffRole(fallback: StaffRole): StaffRole {
  const { data: session } = useSession();
  if (session?.kind === 'staff' && session.staffRole) return session.staffRole;
  return fallback;
}

/**
 * The signed-in staff member's real, per-person permission set
 * (`session.permissions`) — `null` when there is no staff session yet (still
 * loading), in which case `can()` falls back to the coarser role map. Prefer
 * this over `useStaffRole` wherever a permission decision is being made.
 */
export function useStaffPermissions(): Permission[] | null {
  const { data: session } = useSession();
  return session?.kind === 'staff' ? session.permissions : null;
}
