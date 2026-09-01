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
const EMPTY_FRAME_PX = 16;

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
   * Stripe renders into an iframe inside this node, and its height is the only
   * honest signal that a plan was actually shown. ResizeObserver rather than a
   * one-shot measure, because the iframe resolves its own height after mount.
   *
   * THE THRESHOLD IS NOT ZERO, AND THAT MATTERS
   * An ineligible amount does not produce a 0px element. Measured on the
   * deployed site against a Stripe account with no BNPL plan available, the
   * element still occupies 9px — Stripe mounts its frame and applies its own
   * `margin: -4px 0` regardless of whether it drew anything. A "greater than
   * zero" test would therefore call an empty box content and draw a rule and
   * 16px of padding around nothing, which is precisely the ineligible case
   * this is here to suppress. A real single-line message with its provider
   * logo is comfortably past 16px, so that is the line.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setHasContent(host.getBoundingClientRect().height > EMPTY_FRAME_PX);
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
    fontSizeBase: '14px',
  },
};
