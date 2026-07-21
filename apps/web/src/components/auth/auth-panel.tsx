'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Spark } from '@/components/storefront/art';
import { useReviews } from '@/lib/data/hooks';
import { RETURN_WINDOW_DAYS } from '@/lib/config';

/**
 * The left-hand shop panel of the auth split (design authority: ours).
 *
 * Everything on it is either site copy that already exists elsewhere or is
 * computed from real data through the adapter — no invented business claims
 * (HR#5). The rotating quote is a verbatim Google review pulled with the same
 * `useReviews` hook the storefront uses, so it stays true when Raja swaps the
 * mock adapter for the API.
 */

interface PanelCopy {
  eyebrow: string;
  headline: React.ReactNode;
  lede: string;
}

const COPY: Record<string, PanelCopy> = {
  '/login': {
    eyebrow: 'Fonology · The bench',
    headline: (
      <>
        Welcome <em>back</em> to the bench.
      </>
    ),
    lede: 'Sign in to pick up your orders, repairs and trade-ins where you left them. You never needed an account to start one — it just saves you typing.',
  },
  '/register': {
    eyebrow: 'Fonology · New here',
    headline: (
      <>
        One account. <em>Everything</em> in one place.
      </>
    ),
    lede: 'Orders, repair tickets and sell requests all under one login — with the reference numbers still working exactly as they do without one.',
  },
  '/forgot-password': {
    eyebrow: 'Fonology · Reset',
    headline: (
      <>
        Happens to <em>the best</em> of us.
      </>
    ),
    lede: 'Pop your email in and we’ll send a reset link. Everything you booked or bought is safe on the other side of it.',
  },
  '/staff-login': {
    eyebrow: 'Fonology · Back of house',
    headline: (
      <>
        The <em>back</em> of the counter.
      </>
    ),
    lede: 'Till, jobs board, stock and the day’s takings. Managers land on the dashboard, counter staff go straight to the till.',
  },
};

const TICKER = [
  'Screen repairs',
  'Batteries',
  'Charge ports',
  'Water damage',
  'Tablets & MacBooks',
  'Sell your phone',
  'Click & collect',
  'Bench-tested stock',
];

const QUOTE_MS = 7000;

export function AuthPanel() {
  const pathname = usePathname();
  const copy = COPY[pathname] ?? COPY['/login']!;
  const isStaff = pathname === '/staff-login';

  const { data: reviews } = useReviews();
  const quotes = (reviews ?? []).filter((r) => r.text.length <= 200);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (quotes.length < 2) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % quotes.length), QUOTE_MS);
    return () => window.clearInterval(id);
  }, [quotes.length]);

  const quote = quotes[i % Math.max(quotes.length, 1)];
  const rating =
    reviews && reviews.length > 0
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
      : null;

  return (
    <aside className="auth__panel">
      <p className="auth__watermark" aria-hidden="true">
        Fonology
      </p>

      <div className="auth-rise auth-rise--1">
        <Link href="/" className="auth__brand">
          <Spark variant="red" />
          Fonology<span>.</span>
        </Link>
      </div>

      <div className="auth-rise auth-rise--2">
        <p className="auth__eyebrow">
          <Spark variant="red" />
          {copy.eyebrow}
        </p>
        <h2 className="auth__headline">{copy.headline}</h2>
        <p className="auth__lede">{copy.lede}</p>

        {/* Claims below are the storefront's own approved promises, plus the
            live review average — nothing invented here. */}
        <div className="auth__stats">
          <div className="auth__stat">
            <b>
              {rating ?? '—'}
              <i>★</i>
            </b>
            <span>{reviews ? `Across ${reviews.length} Google reviews` : 'Google reviews'}</span>
          </div>
          <div className="auth__stat">
            <b>{RETURN_WINDOW_DAYS} days</b>
            <span>No-quibble returns, no receipt hunt</span>
          </div>
          <div className="auth__stat">
            <b>Free</b>
            <span>Screen protectors fitted, forever</span>
          </div>
        </div>
      </div>

      <div className="auth-rise auth-rise--3">
        {/* Staff have already read every review on the wall — give them the
            service list instead of the customer testimonial. */}
        {!isStaff && quote ? (
          <figure className="auth__quote">
            {/* key restarts the fade each time the quote changes */}
            <blockquote key={quote.id}>“{quote.text}”</blockquote>
            <figcaption key={`${quote.id}-c`}>
              {quote.name}
              <i aria-hidden="true">{'★'.repeat(quote.rating)}</i>
              <span className="sr-only">{quote.rating} out of 5.</span>
              {quote.device}
            </figcaption>
          </figure>
        ) : null}

        <div className="auth__ticker" aria-hidden="true">
          <div className="auth__ticker-track">
            {/* duplicated once so the -50% translate loops seamlessly */}
            {[0, 1].map((copyIndex) => (
              <div className="auth__ticker-group" key={copyIndex}>
                {TICKER.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

/**
 * Below 1024px the panel is hidden, which would leave the form alone on an
 * empty page. This carries the same three facts in one line so the small
 * screens keep the brand and the reassurance.
 */
export function AuthTrustRow() {
  const { data: reviews } = useReviews();
  const rating =
    reviews && reviews.length > 0
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
      : null;

  return (
    <ul className="auth__trust">
      <li>
        <b>
          {rating ?? '—'}
          <i aria-hidden="true">★</i>
        </b>
        <span className="sr-only">out of 5 </span>on Google
      </li>
      <li>
        <b>{RETURN_WINDOW_DAYS}-day</b> returns
      </li>
      <li>
        <b>Free</b> protector fitting
      </li>
    </ul>
  );
}
