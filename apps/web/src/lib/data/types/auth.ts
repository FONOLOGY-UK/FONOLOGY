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
 * that boundary intact.
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
]);
export type SchemaPermission = z.infer<typeof permissionSchema>;

export const authUserSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: emailSchema,
  kind: z.enum(['customer', 'staff']),
  /**
   * Set for staff sessions — drives the permissions map. Null for customers.
   *
   * NOTE: the schema's staff_role is 2-value (owner|employee); this stays
   * 4-value for backward compatibility with `permissions.config.ts`'s
   * `can()` and every component that already reads it. The API maps
   * owner->owner, employee->counter (the frontend's own generic
   * non-privileged default — see route-guard.tsx's fallback). This mapping
   * is display/UX only; real server-side enforcement always uses
   * `permissions`, never this field.
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
