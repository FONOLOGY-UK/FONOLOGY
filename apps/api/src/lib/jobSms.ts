import type { JobStatus } from '../db/types.js';
import { db } from './db.js';
import { formatPence } from './money.js';
import { toUkMobile } from './phone.js';
import { sendSms } from './sms.js';

/**
 * Repair-stage texts (0105). After a job is created or moves stage, the customer gets the text
 * for that stage — the job's shop's own wording if it has one, otherwise the default — unless the
 * stage is switched off, the customer opted out, or there's no UK mobile on the job. Every
 * attempt is logged against the job (job_sms_log), including the ones skipped, with why.
 *
 * Called after the change has committed, fire-and-forget: notifyJobStage never throws, so a
 * text can never block or undo a repair moving on.
 */

/** Every placeholder a template may use. Unknown ones are refused when a template is saved. */
export const SMS_PLACEHOLDERS = [
  'firstName',
  'customerName',
  'jobNumber',
  'device',
  'status',
  'quote',
  'shopName',
  'shopPhone',
  'courier',
  'tracking',
] as const;

/** How a stage reads in a sentence ("Your repair is {status}"). */
export const SMS_STATUS_WORDS: Record<JobStatus, string> = {
  new: 'booked in',
  in_progress: 'in progress',
  waiting_approval: 'waiting for your OK',
  done: 'ready',
  sent_back: 'on its way back',
  collected: 'collected',
  cancelled: 'cancelled',
};

export function unknownPlaceholders(body: string): string[] {
  const known = new Set<string>(SMS_PLACEHOLDERS);
  return [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((name) => !known.has(name));
}

export function renderSms(body: string, values: Record<string, string>): string {
  return body
    .replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function loadJob(jobId: string) {
  return db
    .selectFrom('jobs as j')
    .innerJoin('shops as s', 's.id', 'j.shop_id')
    .select([
      'j.id',
      'j.shop_id',
      'j.status',
      'j.reference',
      'j.customer_name',
      'j.phone',
      'j.device_description',
      'j.quoted_price',
      'j.revised_quote',
      'j.courier',
      'j.return_tracking_number',
      'j.sms_updates',
      's.name as shop_name',
      's.phone as shop_phone',
    ])
    .where('j.id', '=', jobId)
    .executeTakeFirst();
}

/** The wording a shop uses for a stage: its own row, else the default. Null when neither exists. */
export async function templateFor(shopId: string, status: JobStatus) {
  return db
    .selectFrom('job_sms_templates')
    .select(['body', 'enabled', 'shop_id'])
    .where('status', '=', status)
    .where((eb) => eb.or([eb('shop_id', '=', shopId), eb('shop_id', 'is', null)]))
    .orderBy('shop_id', (ob) => ob.asc().nullsLast())
    .limit(1)
    .executeTakeFirst();
}

export function smsValues(job: NonNullable<Awaited<ReturnType<typeof loadJob>>>) {
  const quote = job.revised_quote ?? job.quoted_price;
  return {
    firstName: job.customer_name.trim().split(/\s+/)[0] ?? '',
    customerName: job.customer_name.trim(),
    jobNumber: job.reference,
    device: job.device_description,
    status: SMS_STATUS_WORDS[job.status],
    quote: quote != null ? formatPence(quote) : 'to be confirmed',
    shopName: job.shop_name,
    shopPhone: job.shop_phone ?? '',
    courier: job.courier ?? 'the courier',
    tracking: job.return_tracking_number ?? '',
  };
}

/**
 * Texts the customer about the job's CURRENT stage and logs the attempt. Returns the log row's
 * id, or null if even logging failed (it never throws).
 */
export async function notifyJobStage(
  jobId: string,
  staffId: string | null,
): Promise<string | null> {
  try {
    const job = await loadJob(jobId);
    if (!job) return null;

    const log = async (fields: {
      state: 'sent' | 'failed' | 'skipped';
      reason?: string | null;
      toPhone?: string | null;
      body?: string | null;
      messageId?: string | null;
    }) => {
      const row = await db
        .insertInto('job_sms_log')
        .values({
          job_id: job.id,
          shop_id: job.shop_id,
          status: job.status,
          state: fields.state,
          reason: fields.reason ?? null,
          to_phone: fields.toPhone ?? null,
          body: fields.body ?? null,
          provider_message_id: fields.messageId ?? null,
          staff_id: staffId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    };

    if (!job.sms_updates)
      return log({ state: 'skipped', reason: 'The customer asked not to be texted' });
    const template = await templateFor(job.shop_id, job.status);
    if (!template || !template.enabled) {
      return log({ state: 'skipped', reason: 'Texts are switched off for this stage' });
    }
    const to = toUkMobile(job.phone);
    if (!to) {
      return log({
        state: 'skipped',
        reason: job.phone
          ? 'The phone number on the job is not a UK mobile'
          : 'No phone number on the job',
      });
    }

    const body = renderSms(template.body, smsValues(job));
    const result = await sendSms(to, body);
    return log({
      state: result.state,
      reason: result.state === 'sent' ? null : result.reason,
      toPhone: to,
      body,
      messageId: result.state === 'sent' ? result.messageId : null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sms] job text failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Fire-and-forget form for routes: the response never waits for, or fails on, a text. */
export function notifyJobStageLater(jobId: string, staffId: string | null): void {
  void notifyJobStage(jobId, staffId);
}
