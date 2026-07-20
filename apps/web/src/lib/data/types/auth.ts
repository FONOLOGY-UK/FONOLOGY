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

export const authUserSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: emailSchema,
  kind: z.enum(['customer', 'staff']),
  /** Set for staff sessions — drives the permissions map. Null for customers. */
  staffRole: staffRoleSchema.nullable(),
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
