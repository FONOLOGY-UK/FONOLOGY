import { db } from './db.js';
import { sendTransactionalEmail } from './email.js';
import { escapeHtml } from './html.js';

/**
 * The email a customer gets when an online order is marked shipped, with the courier and tracking number the
 * shop entered. Fire-and-forget like the order confirmation and the refund email: the status change is already
 * saved, so a failure here is logged and never changes the result.
 */
export async function sendShippedEmail(orderId: string): Promise<void> {
  const row = await db
    .selectFrom('orders')
    .leftJoin('customers', 'customers.id', 'orders.customer_id')
    .select([
      'orders.reference',
      'orders.courier',
      'orders.tracking_number',
      'orders.guest_email',
      'customers.email as customer_email',
    ])
    .where('orders.id', '=', orderId)
    .executeTakeFirst();
  if (!row) return;

  const email = row.guest_email || row.customer_email || null;
  if (!email) {
    // eslint-disable-next-line no-console
    console.error(
      `[email] order ${String(row.reference)} has no email on file — skipping the shipped email.`,
    );
    return;
  }

  const reference = escapeHtml(String(row.reference));
  const result = await sendTransactionalEmail({
    to: { email },
    subject: `Your order has shipped — ${String(row.reference)}`,
    htmlContent: `
    <p>Hello,</p>
    <p>Your order <strong>${reference}</strong> is on its way.</p>
    <p>Courier: <strong>${escapeHtml(String(row.courier ?? ''))}</strong><br>
    Tracking number: <strong>${escapeHtml(String(row.tracking_number ?? ''))}</strong></p>
    <p>You can also look it up any time on our Track page with your order number.</p>
    <p>Fonology</p>
  `,
  });
  // eslint-disable-next-line no-console
  console.log(
    `[email] shipped notification for ${String(row.reference)}: ${
      result.sent ? 'sent' : `not sent (${result.reason})`
    }.`,
  );
}
