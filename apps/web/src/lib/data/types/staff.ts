import { z } from 'zod';
import { emailSchema, idSchema, isoDateSchema, ukPhoneSchema } from './common';

/**
 * Staff roster (item 7, Staff management). This is the people list only —
 * accounts, logins and per-staff PINs are the auth phase (item 9) and Raja's
 * backend. Deactivate rather than delete so history keeps its names.
 */

export const staffRoleSchema = z.enum(['owner', 'manager', 'technician', 'counter']);
export type StaffRole = z.infer<typeof staffRoleSchema>;

export function staffRoleLabel(role: StaffRole): string {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'manager':
      return 'Manager';
    case 'technician':
      return 'Technician';
    case 'counter':
      return 'Counter';
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

export const staffSchema = staffInputSchema.extend({
  id: idSchema,
  startedAt: isoDateSchema,
});
export type Staff = z.infer<typeof staffSchema>;
