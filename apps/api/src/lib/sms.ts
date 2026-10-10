import { config } from '../config.js';
import { maskPhone } from './phone.js';

/**
 * Sending one text. SMS_MODE (config.ts) decides what "send" means:
 *
 *   log    print it (number masked) and report it skipped — the default, so a dev machine or a
 *          test run never texts a real customer. Mailpit catches email; nothing catches SMS.
 *   brevo  Brevo's transactional SMS API (POST /v3/transactionalSMS/send), same key as email.
 *   off    report it skipped.
 *
 * Never throws: a provider outage must not fail the request that triggered the text (a repair
 * moving on). The result says what happened, for the job's SMS log.
 */

export type SmsResult =
  | { state: 'sent'; messageId: string | null }
  | { state: 'failed'; reason: string }
  | { state: 'skipped'; reason: string };

/** GSM-7 covers plain English text; anything outside it needs Unicode (70 characters a part). */
export function needsUnicode(text: string): boolean {
  return !/^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(
    text,
  );
}

export async function sendSms(to: string, content: string): Promise<SmsResult> {
  if (config.smsMode === 'off')
    return { state: 'skipped', reason: 'Texts are turned off (SMS_MODE=off)' };
  if (config.smsMode === 'log' || !config.brevoApiKey) {
    // eslint-disable-next-line no-console
    console.log(`[sms] (not sent, SMS_MODE=${config.smsMode}) to ${maskPhone(to)}: ${content}`);
    return { state: 'skipped', reason: 'Not sent: texts are in test mode (SMS_MODE=log)' };
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/transactionalSMS/send', {
      method: 'POST',
      headers: {
        'api-key': config.brevoApiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: config.brevoSmsSender,
        recipient: to,
        content,
        type: 'transactional',
        unicodeEnabled: needsUnicode(content),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // Brevo's error body can echo the request back (the number, the text); log the status only.
      // eslint-disable-next-line no-console
      console.error(`[sms] Brevo send failed: ${response.status} ${response.statusText}`);
      const reason =
        response.status === 402
          ? 'Brevo has no SMS credits left'
          : response.status === 401
            ? 'Brevo refused the API key'
            : `Brevo refused it (${response.status})`;
      return { state: 'failed', reason };
    }
    const body = (await response.json().catch(() => null)) as {
      messageId?: number | string;
    } | null;
    return { state: 'sent', messageId: body?.messageId != null ? String(body.messageId) : null };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sms] Brevo send threw:', err instanceof Error ? err.message : err);
    return { state: 'failed', reason: 'Could not reach Brevo' };
  }
}
