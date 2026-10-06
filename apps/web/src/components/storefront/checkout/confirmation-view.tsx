'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { FonologyMark } from '@/components/storefront/art';
import { PAYMENT_STATUS_GIVE_UP_MS, useOrderPaymentStatus, useShopDetails } from '@/lib/data/hooks';

/**
 * Order confirmation (6.3) — tracking reference + next steps.
 *
 * Says the order is paid only once the SERVER says so. It used to say "we've emailed your
 * confirmation, your order is on its way" the moment Stripe let the browser go, before the
 * webhook had marked the order paid — and when that webhook never came (every local checkout),
 * the order sat unpaid, invisible to the admin and with its stock untouched, behind a page
 * claiming success (bug report v1, BUG-002). Now it asks GET /orders/:ref/payment-status, which
 * the payment intent id proves this browser paid for, until the answer is in.
 */
export function ConfirmationView({
  reference,
  intentId,
}: {
  reference: string | null;
  intentId: string | null;
}) {
  const tickRef = useRef<HTMLDivElement>(null);
  const { data: status, isError } = useOrderPaymentStatus(reference ?? '', intentId);
  const { data: shop } = useShopDetails();
  const [waitedLong, setWaitedLong] = useState(false);

  const paid = status?.paid === true;

  useEffect(() => {
    const id = setTimeout(() => setWaitedLong(true), PAYMENT_STATUS_GIVE_UP_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!paid) return;
    const id = requestAnimationFrame(() => tickRef.current?.classList.add('is-ticked'));
    return () => cancelAnimationFrame(id);
  }, [paid]);

  if (!reference) {
    return (
      <section className="checkout-page">
        <div className="sf-empty container">
          <FonologyMark className="sf-empty__mark" />
          <strong className="font-display text-ink text-2xl font-extrabold uppercase">
            Nothing to confirm
          </strong>
          <p className="text-muted max-w-sm text-sm">
            This page shows an order confirmation after checkout.
          </p>
          <Link href="/shop" className="btn btn--red">
            <span className="btn__label">Browse the shop</span>
          </Link>
        </div>
      </section>
    );
  }

  const contact = shop?.shopPhone ? ` on ${shop.shopPhone}` : '';
  let title: React.ReactNode;
  let note: string;
  if (paid) {
    title = (
      <>
        Order in. <em>Nice one.</em>
      </>
    );
    // Round 4 #BUG-06 follow-up: every order placed through checkout is a delivery order now —
    // click & collect isn't offered here any more, so this doesn't branch on delivery method.
    note =
      'We’ve emailed your confirmation. Your order is on its way — track it any time with your reference.';
  } else if (status?.cancelled) {
    title = 'Order cancelled';
    note = `This order was cancelled, so nothing is on its way. If you think that’s wrong, call the shop${contact} with your reference.`;
  } else if (!intentId || status === null || isError || waitedLong) {
    // No way to ask (an older link, a free order), or the answer is taking far longer than a
    // webhook normally does. The order is saved either way; never claim more than that.
    title = 'Order received';
    note = `Your order is saved. We’ll email you as soon as your payment is confirmed — usually within minutes. Nothing by the end of the day? Call the shop${contact} with your reference.`;
  } else {
    title = 'Confirming your payment…';
    note = 'This usually takes a few seconds. Please keep this page open.';
  }

  return (
    <section className="checkout-page">
      <div className="container">
        <div className="co-confirm" ref={tickRef} aria-live="polite">
          {paid ? (
            <svg className="ck-tick" viewBox="0 0 96 96" aria-hidden="true">
              <circle className="ck-tick__ring" cx="48" cy="48" r="42" />
              <path className="ck-tick__check" d="M30 50 L43 63 L67 36" />
            </svg>
          ) : null}
          <h1 className="co-confirm__title">{title}</h1>
          <p className="co-confirm__ref">
            Order reference <strong>{reference}</strong>
          </p>
          <p className="wz-done__note" style={{ margin: '0 auto 28px' }}>
            {note}
          </p>
          <div className="wz-done__actions">
            {paid ? (
              <Link href={`/track?ref=${encodeURIComponent(reference)}`} className="btn btn--ink">
                <span className="btn__label">Track my order</span>
              </Link>
            ) : null}
            <Link href="/shop" className="btn btn--ghost">
              <span className="btn__label">Keep browsing</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
