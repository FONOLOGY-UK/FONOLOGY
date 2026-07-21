import type { StaffRole } from '@/lib/data/types';

/**
 * PERMISSIONS — the single source of truth (item 8).
 * ==================================================
 * Role → allowed capabilities. Changing what a role can do is a ONE-LINE edit
 * to this map — nothing is hardcoded in components. Enforcement happens via:
 *   • `can(role, permission)` — the primitive
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
  | 'returns.manage' // refunds + window overrides
  | 'labels.manage' // label designer
  | 'staff.manage' // roster
  | 'settings.manage'; // shop dials + PIN

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
  'labels.manage',
  'staff.manage',
  'settings.manage',
];

export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: MANAGEMENT_PERMISSIONS,
  manager: MANAGEMENT_PERMISSIONS,
  technician: EMPLOYEE_PERMISSIONS,
  counter: EMPLOYEE_PERMISSIONS,
};

export function can(role: StaffRole, permission: Permission): boolean {
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
  { label: 'Inventory', href: '/pos/inventory', permission: 'inventory.manage' },
  { label: 'Promotions', href: '/pos/promotions', permission: 'promotions.manage' },
  { label: 'Cash', href: '/pos/cash', permission: 'cash.manage' },
  { label: 'Trade-ins', href: '/pos/trade-ins', permission: 'tradein.manage' },
];
