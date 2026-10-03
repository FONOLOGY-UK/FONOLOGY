import { config } from '../config.js';
import { sendTransactionalEmail, type SendEmailResult } from './email.js';
import { escapeHtml } from './html.js';

/**
 * The two sign-in emails: confirm a new customer's address, reset a password.
 * Same plain style as the trade-in and order emails. The link carries the
 * raw one-time token (lib/authSessions.ts); the pages it opens hand it back
 * to the API.
 */

/**
 * Outside production, a link that could not be emailed is printed instead, so
 * a machine with no mail set up can still finish a sign-up or reset. Never in
 * production: the link is a credential.
 */
async function sendWithDevFallback(
  url: string,
  send: Promise<SendEmailResult>,
): Promise<SendEmailResult> {
  const result = await send;
  if (!result.sent && !config.isProduction) {
    // eslint-disable-next-line no-console
    console.log(`[auth-email] not sent (${result.reason}) — the link was: ${url}`);
  }
  return result;
}

export function sendConfirmEmail(
  to: { email: string; name: string },
  token: string,
): Promise<SendEmailResult> {
  const url = `${config.webAppUrl}/auth/confirm?token=${encodeURIComponent(token)}`;
  return sendWithDevFallback(
    url,
    sendTransactionalEmail({
      to,
      subject: 'Confirm your Fonology account',
      htmlContent: `
    <p>Hi ${escapeHtml(to.name)},</p>
    <p>Thanks for creating a Fonology account. Confirm your email address to sign in:</p>
    <p><a href="${url}">${url}</a></p>
    <p>This link works once and expires in 24 hours. If you didn't sign up, you can ignore this email.</p>
    <p>Fonology</p>
  `,
    }),
  );
}

export function sendPasswordResetEmail(email: string, token: string): Promise<SendEmailResult> {
  const url = `${config.webAppUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return sendWithDevFallback(
    url,
    sendTransactionalEmail({
      to: { email },
      subject: 'Reset your Fonology password',
      htmlContent: `
    <p>Hi,</p>
    <p>Someone asked to reset the password for this email address. To choose a new one, follow this link:</p>
    <p><a href="${url}">${url}</a></p>
    <p>This link works once and expires in 1 hour. If it wasn't you, ignore this email — your password stays as it is.</p>
    <p>Fonology</p>
  `,
    }),
  );
}
