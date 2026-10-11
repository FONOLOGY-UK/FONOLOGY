import { db } from './db.js';
import { sendTransactionalEmail } from './email.js';
import { formatPence } from './money.js';
import { escapeHtml } from './html.js';

/**
 * The email a customer gets when an ONLINE order is refunded. Till (counter) refunds have no email: the
 * customer is standing there and holds the printed refund receipt.
 *
 * Fire-and-forget, like the order confirmation (lib/orderPayments.ts): the refund is already recorded by the
 * time this runs, so a failure here is logged and never changes the refund's result.
 */
export async function sendRefundEmail(refundId: string): Promise<void> {
  const row = await db
    .selectFrom('refunds')
    .innerJoin('orders', 'orders.id', 'refunds.order_id')
    .leftJoin('customers', 'customers.id', 'orders.customer_id')
    .select([
      'refunds.reference as refund_reference',
      'refunds.amount',
      'refunds.stripe_refund_id',
      'refunds.refund_tender',
      'orders.reference as order_reference',
      'orders.total as order_total',
      'orders.guest_email',
      'customers.email as customer_email',
    ])
    .where('refunds.id', '=', refundId)
    .executeTakeFirst();
  if (!row) return;

  const email = row.guest_email || row.customer_email || null;
  if (!email) {
    // eslint-disable-next-line no-console
    console.error(
      `[email] order ${String(row.order_reference)} has no email on file — skipping the refund notification.`,
    );
    return;
  }

  const toCard = Boolean(row.stripe_refund_id);
  const where = toCard
    ? 'back to the card you paid with. Banks usually take 5–10 working days to show it.'
    : 'by the method agreed with the shop.';

  const result = await sendTransactionalEmail({
    to: { email },
    subject: `Refund issued — ${String(row.order_reference)}`,
    htmlContent: `
    <p>Hello,</p>
    <p>We've refunded <strong>${formatPence(row.amount)}</strong> for your order
    <strong>${escapeHtml(String(row.order_reference))}</strong>, ${where}</p>
    <p>Refund reference: ${escapeHtml(String(row.refund_reference))}.
    The order was ${formatPence(row.order_total)} in total.</p>
    <p>If anything looks wrong, reply to this email or call the shop.</p>
    <p>Fonology</p>
  `,
  });
  // eslint-disable-next-line no-console
  console.log(
    `[email] refund notification for ${String(row.order_reference)}: ${
      result.sent ? 'sent' : `not sent (${result.reason})`
    }.`,
  );
}
