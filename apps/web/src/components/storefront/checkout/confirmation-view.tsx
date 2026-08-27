'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Spark } from '@/components/storefront/art';

/** Order confirmation (6.3) — tracking reference + next steps. */
export function ConfirmationView({
  reference,
  email,
}: {
  reference: string | null;
  email: string | null;
}) {
  const tickRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => tickRef.current?.classList.add('is-ticked'));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!reference) {
    return (
      <section className="checkout-page">
        <div className="sf-empty container">
          <Spark variant="red" />
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

  return (
    <section className="checkout-page">
      <div className="container">
        <div className="co-confirm" ref={tickRef}>
          <svg className="ck-tick" viewBox="0 0 96 96" aria-hidden="true">
            <circle className="ck-tick__ring" cx="48" cy="48" r="42" />
            <path className="ck-tick__check" d="M30 50 L43 63 L67 36" />
          </svg>
          <h1 className="co-confirm__title">
            Order in. <em>Nice one.</em>
          </h1>
          <p className="co-confirm__ref">
            Order reference <strong>{reference}</strong>
          </p>
          {/* Round 4 #BUG-06 follow-up: every order placed through checkout is
              a delivery order now — click & collect isn't offered here any
              more, so this no longer needs to branch on delivery method. */}
          <p className="wz-done__note" style={{ margin: '0 auto 28px' }}>
            We’ve emailed your confirmation. Your order is on its way — track it any time with your
            reference.
          </p>
          <div className="wz-done__actions">
            <Link
              href={`/track?ref=${encodeURIComponent(reference)}${email ? `&email=${encodeURIComponent(email)}` : ''}`}
              className="btn btn--ink"
            >
              <span className="btn__label">Track my order</span>
            </Link>
            <Link href="/shop" className="btn btn--ghost">
              <span className="btn__label">Keep browsing</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
