import { z } from 'zod';
import { emailSchema, idSchema } from './common';
import { staffRoleSchema } from './staff';

/**
 * Auth (item 9) — UI-ONLY shapes over the mock adapter. Raja swaps in the
 * real implementation (likely Supabase Auth) behind the same interface.
 *
 * BUSINESS RULE: customer accounts are OPTIONAL. Nothing in the storefront —
 * browsing, buying, repair requests, sell requests, tracking — is ever gated
 * behind a login. An account only makes order/repair tracking more convenient.
 */

/**
 * The schema's real permission set (public.permission, 0002_identity.sql).
 * Kept independent of `@/lib/permissions.config`'s `Permission` union rather
 * than importing it — this file is deliberately framework-free (see the
 * module comment above), and the two lists are already name-for-name
 * identical, so duplicating the 15 literals here costs nothing and keeps
 * that boundary intact. (16 literals as of `reviews.manage`, Round 3
 * follow-up #4 — 0052_reviews_permission.sql.)
 */
export const permissionSchema = z.enum([
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
  'reviews.manage',
]);
export type SchemaPermission = z.infer<typeof permissionSchema>;

export const authUserSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: emailSchema,
  kind: z.enum(['customer', 'staff']),
  /**
   * Set for staff sessions — a coarse label only. Null for customers.
   *
   * Two-value, matching `staff_role` in the database. The API used to
   * translate employee->counter to satisfy a four-value frontend enum that
   * invented three roles the server never had; both the enum and the
   * translation are gone. Real enforcement always uses `permissions`, never
   * this field.
   */
  staffRole: staffRoleSchema.nullable(),
  /**
   * The real, per-person granted permission set from `staff_permissions` —
   * additive field, not present on the original mock contract. Null for
   * customers. `permissions.config.ts`'s `can()` now prefers this field
   * whenever it's present (via `useStaffPermissions()`), falling back to
   * the coarser mapped `staffRole` only when it isn't (mock mode, or before
   * a session has loaded). Either way this only ever drives what the UI
   * shows — every actual write still goes through the API, which checks
   * `permissions` directly and never trusts anything client-side.
   */
  permissions: z.array(permissionSchema).nullable(),
  /**
   * The till/dashboard session this sign-in resolved to. Locking is scoped to
   * this row.
   *
   * Note it is per-ACCOUNT, not per-device: POST /staff/signin reuses the most
   * recent open `staff_sessions` row, so two devices signed in as the same
   * person share one session and locking either locks both. Fine as long as
   * every staff member has their own login (the confirmed policy). See the
   * matching note in apps/api/src/routes/staff.routes.ts.
   */
  staffSessionId: z.string().nullish(),
  /**
   * Whether this staff session is locked, read fresh from `staff_sessions` on
   * every request. THE server owns this — the screen only reflects it. A
   * reload, a new tab, or clearing local storage cannot change it, which is
   * the entire point of the lock.
   */
  locked: z.boolean().optional().default(false),
  /**
   * Round 5 Phase 2 #4 — the staff member's own auto-lock override, in
   * minutes. Null/omitted means "use the shop default"
   * (`shopSettings.idleLockMinutes`); always null for a customer session.
   */
  idleLockMinutes: z.number().int().positive().nullable().optional(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const signInInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'At least 8 characters'),
});
export type SignInInput = z.infer<typeof signInInputSchema>;

export const signUpInputSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name'),
  email: emailSchema,
  password: z.string().min(8, 'At least 8 characters'),
});
export type SignUpInput = z.infer<typeof signUpInputSchema>;

/**
 * Round 5 #30 — "Save my information" at checkout. Signed-in customers
 * only (nothing in the storefront ever requires an account, per this
 * file's own header — this is a convenience for an account someone
 * already has, not a reason to create one). Maps onto the real
 * `customer_addresses` table's `line1`/`postcode` columns — that table
 * already supports a full address book (label, line2, city, county,
 * multiple rows), but the checkout form only ever collects one free-text
 * address line today, so this shape stays exactly that, one line and a
 * postcode, until the form itself grows the structured fields to match.
 */
export const customerAddressSchema = z.object({
  address: z.string().min(1),
  postcode: z.string().min(1),
});
export type CustomerAddress = z.infer<typeof customerAddressSchema>;
