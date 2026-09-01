'use client';

import { useEffect, useRef, useState } from 'react';
import { Elements, PaymentMethodMessagingElement } from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/payments/stripe-client';
import type { Money } from '@/lib/data/types';

/**
 * Buy-now-pay-later messaging, at the point the purchase decision is made.
 *
 * WHY THIS IS STRIPE'S ELEMENT AND NOT OUR OWN MARKUP
 * BNPL messaging in the UK is a regulated financial promotion, and Clearpay
 * publishes mandatory brand rules covering the logo, its colour and the exact
 * wording. Writing "pay in 4 instalments of £10" by hand would be inventing
 * regulated credit copy, and it would be wrong the moment a plan changes.
 *
 * Stripe's Payment Method Messaging Element renders the approved wording and
 * branding, localised, and carries its own info modal (the ⓘ) containing the
 * plan breakdown, a summary of terms and a link to each provider's full terms.
 * That modal is why this component deliberately has NO custom disclosure of
 * its own: the interaction that reveals how the instalments break down already
 * exists inside the element, written by the people allowed to write it.
 *
 * Everything this file owns is therefore layout and chrome. Not one word of
 * the customer-facing copy is ours.
 *
 * ELIGIBILITY IS STRIPE'S DECISION, NOT OURS
 * Clearpay has minimum and maximum order values, and is United Kingdom only.
 * Stripe's docs are explicit that the element "only displays plans that the
 * customer is eligible for based on their location, the currency, and the
 * amount", and that it renders nothing when the country/currency pair has no
 * eligible plan. So we pass the real amount and let it decide, rather than
 * hardcoding thresholds here that would drift out of date and mislead someone.
 *
 * `paymentMethodTypes` is deliberately NOT set. Left unset, the element mirrors
 * the payment methods actually enabled in the Stripe Dashboard — the same
 * source of truth that decides what the Payment Element offers at checkout. If
 * we hardcoded Clearpay here and it were ever switched off, the product page
 * would advertise a method the checkout no longer offers.
 *
 * THE EMPTY CASE
 * When there is no eligible plan the element renders an empty box, not a
 * missing one, so the surrounding chrome would otherwise leave a stray rule
 * and padding behind. The container is measured and stays `hidden` until it
 * actually has height, which also covers a blocked/failed Stripe.js.
 */
export function BnplMessage({
  amount,
  className,
}: {
  /** Price in pence, for the quantity actually being bought. */
  amount: Money;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hasContent, setHasContent] = useState(false);

  /**
   * Stripe renders into an iframe inside this node. ResizeObserver rather than
   * a one-shot measure, because the iframe resolves its own height after mount.
   *
   * DO NOT RAISE THIS THRESHOLD. It has already been broken once.
   *
   * The reasoning that breaks it goes: "an ineligible amount still leaves a
   * ~9px frame, so raise the bar above 9 and only real messages count." That
   * is wrong, because a REAL message measures about 12px here — Stripe applies
   * `margin: -4px 0` to its own element, so ~8px comes off whatever it drew.
   * Empty is 9 and real is 12; there is no comfortable gap to aim at, and a
   * threshold of 16 silently hid a working Clearpay message in production.
   *
   * The failure modes are not symmetrical. Too low: a hairline rule appears
   * above an empty box on an ineligible basket — untidy. Too high: the
   * messaging disappears entirely and nobody finds out, which is the whole
   * feature gone. So this stays low deliberately.
   *
   * Also worth knowing before re-measuring any of this: a browser tab that is
   * not being composited never paints a cross-origin iframe, so the host reads
   * as collapsed no matter what Stripe actually rendered. Heights measured in
   * a background or headless-hidden tab mean nothing here.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setHasContent(host.getBoundingClientRect().height > 4);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [amount]);

  // No key configured (or a server render) — nothing to show, and nothing that
  // needs saying about it.
  if (!stripePromise) return null;
  if (amount <= 0) return null;

  return (
    <div className={['bnpl', hasContent ? 'is-live' : '', className].filter(Boolean).join(' ')}>
      <div className="bnpl__host" ref={hostRef}>
        <Elements stripe={stripePromise} options={{ appearance: BNPL_APPEARANCE }}>
          <PaymentMethodMessagingElement
            options={{
              amount,
              currency: 'GBP',
              countryCode: 'GB',
            }}
          />
        </Elements>
      </div>
    </div>
  );
}

/**
 * Appearance API only — font, size and colour, so the messaging sets in the
 * storefront's own type rather than Stripe's default. The logo, the wording and
 * the layout of the message itself are left exactly as Stripe renders them.
 */
const BNPL_APPEARANCE = {
  variables: {
    colorText: '#141414',
    colorTextSecondary: '#6b6b6b',
    fontFamily:
      'var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    // 16px, not the 14px this started at. Stripe scales the whole element —
    // provider logos, the message and the small print — off this one value, so
    // it is the only lever that makes the block sit at the same weight as the
    // PDP copy around it. At 14px it read as a footnote next to a 15.5px
    // button and a 14px notice box, which undersells the one line on the page
    // that tells someone they can afford this today.
    fontSizeBase: '16px',
  },
  rules: {
    // A touch more room under the message so the small print is not crowded
    // against the ID-documents box below it. Spacing only.
    '.PaymentMethodMessaging': {
      lineHeight: '1.5',
    },
  },
};
