import { z } from 'zod';
import { emailSchema, idSchema, isoDateSchema, isoDateTimeSchema, ukPhoneSchema } from './common';

/**
 * Staff roster (item 7, Staff management). Deactivate rather than delete so
 * history keeps its names.
 *
 * ROLE IS TWO-VALUE, matching the database's `staff_role` enum exactly. The
 * mock originally invented four (owner/manager/technician/counter); none of
 * `manager`, `technician` or `counter` has ever existed server-side, so the
 * roster failed to parse the moment it met a real `employee` row AND the add
 * form's own options were rejected by POST /admin/staff, which accepts only
 * `owner | employee`. It was broken in both directions.
 *
 * Role is a coarse label, not the access-control model: permissions are
 * granted PER PERSON in `staff_permissions` and enforced server-side. See
 * `permissions.config.ts` — `can()` reads the real per-person set and falls
 * back to the role map only before a session has loaded.
 */

export const staffRoleSchema = z.enum(['owner', 'employee']);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/**
 * Round 4 #BUG-12: the enum value stays `owner` — that's what
 * `staff_role`/`default_permissions()` key off in the database, and
 * renaming it there would be the real, riskier version of this ask. Only
 * the word shown to a person changes.
 */
export function staffRoleLabel(role: StaffRole): string {
  switch (role) {
    case 'owner':
      return 'Admin';
    case 'employee':
      return 'Employee';
  }
}

export const staffInputSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name'),
  role: staffRoleSchema,
  phone: ukPhoneSchema,
  email: emailSchema,
  active: z.boolean(),
  /**
   * Round 4 #BUG-12: optional on purpose, create-only. The API already
   * accepted this and auto-generated one when it was missing — it just had
   * nowhere to land from this side, and nowhere to show what got
   * generated. Left unset on an edit; the API has never supported changing
   * a password through this endpoint (see the email note above it).
   */
  password: z.string().min(8, 'At least 8 characters').optional(),
});
export type StaffInput = z.infer<typeof staffInputSchema>;

/**
 * A roster row as the API returns it. Deliberately NOT `staffInputSchema
 * .extend(...)`: what the form sends and what the server returns are
 * different shapes, and conflating them is what broke this screen and
 * /admin/cash. `phone` is nullable on the way out (real rows have none),
 * required on the way in.
 */
export const staffSchema = staffInputSchema.omit({ phone: true, password: true }).extend({
  id: idSchema,
  phone: z.string().nullable(),
  startedAt: isoDateSchema,
  /** The real per-person grant set. Absent on older API builds. */
  permissions: z.array(z.string()).optional(),
  createdAt: isoDateTimeSchema.optional(),
  /**
   * Round 4 #BUG-12: present ONLY in the response to the create call that
   * generated it, and only when the caller didn't supply their own
   * password — same "shown once, never logged" shape as B5's sell-request
   * acceptance token. Never present on a list read; there's nothing to
   * strip if a caller forgets to clear it, because the server only ever
   * sends it the one time.
   */
  temporaryPassword: z.string().optional(),
});
export type Staff = z.infer<typeof staffSchema>;
