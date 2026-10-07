import { z } from 'zod';
import { jobStatusSchema } from './job';

/**
 * Repair-stage texts (0105) — apps/api/src/routes/admin/notifications.ts and the /jobs/:id/sms
 * routes, field for field.
 */

export const smsTemplateSchema = z.object({
  status: jobStatusSchema,
  enabled: z.boolean(),
  body: z.string(),
  /** 'shop' = this shop's own wording; 'default' = the text every shop falls back to. */
  source: z.enum(['shop', 'default']),
  updatedAt: z.string().nullable(),
});
export type SmsTemplate = z.infer<typeof smsTemplateSchema>;

export const smsTemplatesScreenSchema = z.object({
  /** 'default' when the switcher is on All shops: the defaults are being edited. */
  scope: z.enum(['shop', 'default']),
  shopId: z.string().nullable(),
  shopName: z.string().nullable(),
  /** What the API does with a text right now: 'log' = test mode, nothing reaches a phone. */
  smsMode: z.enum(['off', 'log', 'brevo']),
  placeholders: z.array(z.string()),
  templates: z.array(smsTemplateSchema),
});
export type SmsTemplatesScreen = z.infer<typeof smsTemplatesScreenSchema>;

export const jobSmsSchema = z.object({
  id: z.string(),
  status: jobStatusSchema,
  state: z.enum(['sent', 'failed', 'skipped']),
  reason: z.string().nullable(),
  toPhone: z.string().nullable(),
  body: z.string().nullable(),
  staffName: z.string().nullable(),
  createdAt: z.string(),
});
export type JobSms = z.infer<typeof jobSmsSchema>;

/** Sample values for the template preview — the same names the API fills in. */
export const SMS_SAMPLE_VALUES: Record<string, string> = {
  firstName: 'Sam',
  customerName: 'Sam Taylor',
  jobNumber: 'JOB-1042',
  device: 'iPhone 13',
  status: 'ready',
  quote: '£89.99',
  shopName: 'Fonology',
  shopPhone: '0141 374 0365',
  courier: 'Royal Mail',
  tracking: 'AB123456789GB',
};

export function renderSmsPreview(body: string, values: Record<string, string>): string {
  return body
    .replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const GSM7 =
  /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\[~\]|€]*$/;

/** How many SMS parts a text costs: 160/153 characters in plain text, 70/67 with emoji etc. */
export function smsParts(text: string): { parts: number; unicode: boolean } {
  const unicode = !GSM7.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return { parts: text.length <= single ? 1 : Math.ceil(text.length / multi), unicode };
}
