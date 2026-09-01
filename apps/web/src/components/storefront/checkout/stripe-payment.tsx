'use client';

import { useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/payments/stripe-client';
import { formatGBP, type Money } from '@/lib/data/types';

/**
 * The card step.
 *
 * WHAT THIS COMPONENT IS ALLOWED TO KNOW ABOUT MONEY: NOTHING AUTHORITATIVE.
 * The `amount` prop is passed to Elements and printed on the button, and both
 * of those are display concerns. It does NOT decide what gets charged. The
 * charge is built server-side from the order row (see the payment-intent
 * endpoint in orders.routes.ts), and this component's only route to a real
 * payment is the `clientSecret` the server hands back — a value it cannot
 * forge and cannot alter the amount of.
 *
 * That distinction is the whole reason the flow is ordered the way it is:
 *   1. create the order  -> server prices the basket, writes `pending`
 *   2. create the intent -> server reads the total it just wrote
 *   3. confirm the card  -> browser, against a secret tied to that amount
 *
 * The previous version ran 3 before 1, with a total the browser had worked out
 * for itself. Nothing enforced that the money charged and the order recorded
 * were the same number.
 *
 * DEFERRED INTENT MODE
 * Elements is created with `mode: 'payment'` and an amount up front, before
 * any intent exists, so the card fields can render while the customer is still
 * deciding. Stripe uses that figure ONLY to choose which payment methods to
 * offer (some have minimums) and to label its own buttons. The intent is
 * created at submit time, from the database. Stripe's docs are explicit that
 * the deferred amount is not the charged amount, and that is exactly the
 * property being relied on here.
 */

/**
 * The single storefront-wide Stripe.js instance. It used to be created here,
 * which was right while checkout was the only consumer; the product page and
 * bag drawer now mount BNPL messaging through the same key, so the loader
 * moved to lib/payments/stripe-client and both sides share one promise.
 * Still null when the key is absent — an unconfigured environment must not
 * blow up on import.
 */

export interface StartedPayment {
  /** Null means "no payment provider in this environment" — see the adapter. */
  clientSecret: string | null;
  reference: string;
  email: string;
}

/**
 * What the customer already told us on the details step.
 *
 * WHY THIS IS PASSED IN AT ALL
 * The Payment Element renders its own billing-country selector and defaults it
 * by geolocation. Stripe then filters the offered methods by that country —
 * and Clearpay is United Kingdom only. A customer sitting anywhere else, or
 * behind a VPN, was shown a form defaulted to their own country and silently
 * lost Clearpay and Klarna from the list, with nothing to explain why.
 *
 * This shop delivers to the UK and prices in GBP, so GB is the right default,
 * and we already have the name, email, phone, address and postcode from the
 * previous step. Passing them means the customer does not type an address
 * twice, and the method list is correct on first render.
 */
export interface BillingDetails {
  name: string;
  email: string;
  phone: string;
  line1?: string;
  postalCode?: string;
}

interface Props {
  /** Display + payment-method selection only. Never the charged amount. */
  amount: Money;
  disabled: boolean;
  billing: BillingDetails;
  /**
   * Creates the order (if it doesn't exist yet) and its payment intent, and
   * returns what's needed to confirm. Throws with a readable message on
   * failure — an out-of-stock line, a vape that slipped through, a dead API.
   */
  onStart: () => Promise<StartedPayment>;
  /** Payment is settled (or genuinely under way). Hand over to confirmation. */
  onPaid: (payment: StartedPayment) => void;
}

/** Brand-matched Stripe Elements theme — see globals.css for the source values. */
const ELEMENTS_APPEARANCE = {
  theme: 'flat' as const,
  variables: {
    colorPrimary: '#e5231b',
    colorBackground: '#ffffff',
    colorText: '#141414',
    colorDanger: '#e5231b',
    fontFamily:
      'var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSizeBase: '15px',
    spacingUnit: '4px',
    borderRadius: '12px',
  },
  rules: {
    '.Input': {
      border: '1px solid rgba(20,20,20,0.14)',
      boxShadow: 'none',
      padding: '13px 14px',
    },
    '.Input:focus': {
      border: '1px solid #141414',
      boxShadow: 'none',
    },
    '.Label': {
      fontWeight: '600',
      fontSize: '12px',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    },
  },
};

function PayForm({ amount, disabled, billing, onStart, onPaid }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);

    // Validate the card fields BEFORE creating anything server-side. Getting
    // this order wrong would leave a pending order behind every time someone
    // mistyped their card number.
    const submitResult = await elements.submit();
    if (submitResult.error) {
      setError(submitResult.error.message ?? 'Please check your card details.');
      setBusy(false);
      return;
    }

    let started: StartedPayment;
    try {
      started = await onStart();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'We could not start that payment. Please try again.',
      );
      setBusy(false);
      return;
    }

    // No provider configured in this environment (mock adapter). The order
    // exists and there is nothing to charge against.
    if (!started.clientSecret) {
      onPaid(started);
      return;
    }

    const confirmation = await stripe.confirmPayment({
      elements,
      clientSecret: started.clientSecret,
      confirmParams: {
        // Only used by payment methods that navigate away (some wallets, and
        // Clearpay if it is ever switched on). Cards resolve in place, which
        // is what `redirect: 'if_required'` asks for.
        return_url: `${window.location.origin}/checkout/confirmation?ref=${encodeURIComponent(
          started.reference,
        )}&email=${encodeURIComponent(started.email)}`,
        // Bug fix: the Element's `fields.billingDetails.address.country` is
        // set to 'never' below, which hides the field from the UI but does
        // NOT submit the defaultValue on confirm — Stripe requires any
        // 'never' field to be supplied here explicitly, or confirmPayment
        // throws IntegrationError at runtime. This shop bills UK addresses
        // only (apps/api has no `country` column anywhere in the order
        // schema — delivery_quote() prices off postcode alone), so 'GB' is
        // the correct, non-guessed value, matching the Element's own
        // hardcoded defaultValue.address.country below.
        payment_method_data: {
          billing_details: {
            address: { country: 'GB' },
          },
        },
      },
      redirect: 'if_required',
    });

    if (confirmation.error) {
      // A declined card lands here. The ORDER IS DELIBERATELY LEFT IN PLACE,
      // still `pending`, and the cart is not cleared — the customer can fix
      // their card and press Pay again, and the server's idempotency key means
      // the retry attaches to the same order rather than making a second one.
      setError(confirmation.error.message ?? 'That payment was declined. Please try another card.');
      setBusy(false);
      return;
    }

    const status = confirmation.paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing') {
      // 'processing' is not a failure — some methods settle asynchronously.
      // Either way the customer is done; the webhook is what actually marks
      // the order paid, so the confirmation page reads the order rather than
      // being told the outcome by the browser.
      onPaid(started);
      return;
    }

    setError('That payment did not complete. Please try again.');
    setBusy(false);
  };

  return (
    <div className="ck-stripe">
      <PaymentElement
        options={{
          layout: 'tabs',
          defaultValues: {
            billingDetails: {
              name: billing.name || undefined,
              email: billing.email || undefined,
              phone: billing.phone || undefined,
              address: {
                // Hard-coded GB, not read from the form: this is the BILLING
                // country, the shop is UK-only, and it is what decides whether
                // Clearpay is offered at all.
                country: 'GB',
                line1: billing.line1 || undefined,
                postal_code: billing.postalCode || undefined,
              },
            },
          },
          // Bug fix (post-"final pass" report #5a): `defaultValues` only
          // pre-fills the country field — it does not restrict what the
          // dropdown offers, so the customer could still pick any of
          // Stripe's ~150 countries even though this shop only ever bills
          // in GBP to UK addresses. `fields.billingDetails.address.country:
          // 'never'` removes the selector entirely; the 'GB' defaultValue
          // above is still submitted underneath it (Stripe's own documented
          // behaviour for a hidden-but-defaulted field), so Clearpay
          // eligibility is unaffected.
          fields: {
            billingDetails: {
              address: { country: 'never' },
            },
          },
        }}
      />

      {error ? (
        <p className="ck-stripe__error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        className={busy ? 'btn btn--red btn--full is-busy' : 'btn btn--red btn--full'}
        onClick={() => void submit()}
        disabled={disabled || busy || !stripe}
      >
        <span className="btn__label">{busy ? 'Taking payment…' : `Pay ${formatGBP(amount)}`}</span>
      </button>
    </div>
  );
}

/**
 * Fallback for an environment with no publishable key — mock mode, or a dev
 * machine that hasn't been given Stripe keys yet.
 *
 * It is deliberately NOT a silent pass-through that looks like a real payment
 * screen. Anyone looking at it should be able to tell at a glance that no
 * money is involved, because the one thing worse than a checkout that can't
 * take payment is one that appears to have taken it.
 */
function NoProviderForm({ amount, disabled, onStart, onPaid }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onPaid(await onStart());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place that order.');
      setBusy(false);
    }
  };

  return (
    <div className="ck-stripe">
      <p className="ck-note ck-note--warn">
        No payment provider is configured in this environment, so no card details are collected and
        no money is taken. The order is still created and can be followed through the admin screens.
      </p>
      {error ? (
        <p className="ck-stripe__error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className={busy ? 'btn btn--red btn--full is-busy' : 'btn btn--red btn--full'}
        onClick={() => void submit()}
        disabled={disabled || busy}
      >
        <span className="btn__label">
          {busy ? 'Placing order…' : `Place order · ${formatGBP(amount)}`}
        </span>
      </button>
    </div>
  );
}

export function StripePaymentSection(props: Props) {
  if (!stripePromise) return <NoProviderForm {...props} />;

  return (
    <Elements
      stripe={stripePromise}
      options={{
        mode: 'payment',
        // Stripe rejects a zero amount here. A basket always has lines and
        // every line has a price, so this floor is a guard against an
        // impossible state rather than a real case.
        amount: Math.max(props.amount, 1),
        currency: 'gbp',
        appearance: ELEMENTS_APPEARANCE,
      }}
    >
      <PayForm {...props} />
    </Elements>
  );
}
