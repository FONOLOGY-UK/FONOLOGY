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

export function staffRoleLabel(role: StaffRole): string {
  switch (role) {
    case 'owner':
      return 'Owner';
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
});
export type StaffInput = z.infer<typeof staffInputSchema>;

/**
 * A roster row as the API returns it. Deliberately NOT `staffInputSchema
 * .extend(...)`: what the form sends and what the server returns are
 * different shapes, and conflating them is what broke this screen and
 * /admin/cash. `phone` is nullable on the way out (real rows have none),
 * required on the way in.
 */
export const staffSchema = staffInputSchema.omit({ phone: true }).extend({
  id: idSchema,
  phone: z.string().nullable(),
  startedAt: isoDateSchema,
  /** The real per-person grant set. Absent on older API builds. */
  permissions: z.array(z.string()).optional(),
  createdAt: isoDateTimeSchema.optional(),
});
export type Staff = z.infer<typeof staffSchema>;
