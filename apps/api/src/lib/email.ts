import { config } from '../config.js';

/**
 * Transactional email via Brevo's HTTP API.
 * =========================================================================
 * The FIRST email-sending code in this app — there was no existing
 * order-confirmation sender to match the style of, despite that being the
 * original assumption. Kept deliberately small: one function, one concern.
 *
 * Fails soft, not hard. A trade-in acceptance link is still generated and
 * still returned to staff (who can copy-paste it as a fallback — see
 * sell.routes.ts) whether or not the email goes out, so an email failure or
 * a missing BREVO_API_KEY must never block the route that triggered it. This
 * logs loudly and returns a result the caller can act on, rather than
 * throwing.
 */

export interface SendEmailResult {
  sent: boolean;
  /** Only set when sent is false — never a stack trace, never leaks the payload. */
  reason?: string;
}

export async function sendTransactionalEmail(params: {
  to: { email: string; name?: string };
  subject: string;
  htmlContent: string;
}): Promise<SendEmailResult> {
  if (!config.brevoApiKey) {
    // eslint-disable-next-line no-console
    console.error(
      '[email] BREVO_API_KEY not set — skipping send:',
      params.subject,
      params.to.email,
    );
    return { sent: false, reason: 'not configured' };
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': config.brevoApiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: config.brevoSenderEmail, name: config.brevoSenderName },
        to: [params.to],
        subject: params.subject,
        htmlContent: params.htmlContent,
      }),
    });

    if (!response.ok) {
      // Brevo's error body may echo back parts of the request; never log it
      // verbatim since a token could in principle end up in there via the
      // rendered HTML. Status + statusText is enough to diagnose from here.
      // eslint-disable-next-line no-console
      console.error(`[email] Brevo send failed: ${response.status} ${response.statusText}`);
      return { sent: false, reason: `Brevo responded ${response.status}` };
    }

    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[email] Brevo send threw:', err instanceof Error ? err.message : err);
    return { sent: false, reason: 'network error' };
  }
}
