import type { StaffRole } from '@/lib/data/types';

/**
 * PERMISSIONS — the single source of truth (item 8).
 * ==================================================
 * Role → allowed capabilities. Changing what a role can do is a ONE-LINE edit
 * to this map — nothing is hardcoded in components. Enforcement happens via:
 *   • `can(role, permission, permissions?)` — the primitive; prefers the real
 *     per-person `permissions` set when given, falls back to `role`
 *   • `<Can>`                 — inline UI guard (components/shared/can.tsx)
 *   • `<RouteGuard>`          — page-level guard (components/pos/route-guard.tsx)
 * Employee panel tabs are DERIVED from this map, so removing a permission
 * removes the tab, the route access and every related control at once.
 *
 * This is a UI capability map for the mock build. Raja's backend must enforce
 * the same rules server-side — the map's shape is designed to move into
 * `packages/contracts` with the rest of the domain types.
 */

export type Permission =
  // Employee-facing capabilities
  | 'pos.operate' // run the till
  | 'jobs.manage' // bench pipeline
  | 'inventory.manage' // stock counts + product CRUD
  | 'promotions.manage' // in-store bulk pricing
  | 'cash.manage' // float & petty cash
  | 'tradein.manage' // record devices bought in over the counter
  | 'sales.today' // TODAY'S sales total ONLY — never history
  // Owner/manager-only capabilities
  | 'costs.view' // cost prices, profit margins
  | 'analytics.view' // dashboards, historical sales
  | 'payments.view' // full settled ledger
  | 'reports.view' // business performance reports
  | 'returns.manage' // refunds
  | 'returns.override' // self-authorise an out-of-window refund (separate from ordinary returns.manage — red-team finding #6b)
  | 'labels.manage' // label designer
  | 'staff.manage' // roster
  | 'settings.manage' // shop dials + PIN
  | 'reviews.manage'; // homepage testimonials

const EMPLOYEE_PERMISSIONS: Permission[] = [
  'pos.operate',
  'jobs.manage',
  'inventory.manage',
  'promotions.manage',
  'cash.manage',
  'tradein.manage',
  'sales.today',
];

const MANAGEMENT_PERMISSIONS: Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  'costs.view',
  'analytics.view',
  'payments.view',
  'reports.view',
  'returns.manage',
  'returns.override',
  'labels.manage',
  'staff.manage',
  'settings.manage',
  'reviews.manage',
];

export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: MANAGEMENT_PERMISSIONS,
  employee: EMPLOYEE_PERMISSIONS,
};

/**
 * `permissions`, when given (the real per-person set from `session.permissions`
 * — see auth.ts), is authoritative and checked directly, ignoring the role
 * map entirely. `role` is only the fallback for when that real data isn't
 * available yet (mock mode, or before a session has loaded) — exactly the
 * B1-report follow-up this wires up. Server-side enforcement never depended
 * on this function either way; this only changes what a tab/button shows.
 */
export function can(
  role: StaffRole,
  permission: Permission,
  permissions?: Permission[] | null,
): boolean {
  if (permissions) return permissions.includes(permission);
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Employee panel tabs, derived from permissions — not hardcoded per role. */
export interface PosTab {
  label: string;
  href: string;
  permission: Permission;
}

export const POS_TABS: PosTab[] = [
  { label: 'Checkout', href: '/pos', permission: 'pos.operate' },
  { label: 'Jobs', href: '/pos/jobs', permission: 'jobs.manage' },
  // Round 5 Phase 2 #6 — counter staff had no way to see incoming mail-in
  // repair bookings at all before this; same jobs.manage gate as Jobs.
  { label: 'Repair Requests', href: '/pos/submissions', permission: 'jobs.manage' },
  { label: 'Inventory', href: '/pos/inventory', permission: 'inventory.manage' },
  { label: 'Promotions', href: '/pos/promotions', permission: 'promotions.manage' },
  { label: 'Cash', href: '/pos/cash', permission: 'cash.manage' },
  // Round 5 #5: matches the admin nav's Round 4 rename — same page
  // (/pos/trade-ins), same permission, label brought in line.
  { label: 'Sell In Requests', href: '/pos/trade-ins', permission: 'tradein.manage' },
  // TODAY only — `sales.today` is deliberately the narrowest sales permission
  // there is. It must never widen into history (that is `analytics.view`).
  { label: 'My day', href: '/pos/day', permission: 'sales.today' },
  // Round 5 Phase 2 #4 — own PIN + own auto-lock. Gated on pos.operate
  // (the most baseline permission there is), not settings.manage — this is
  // an account managing itself, not the shop-wide dial admin/settings
  // already covers.
  { label: 'Settings', href: '/pos/settings', permission: 'pos.operate' },
];
