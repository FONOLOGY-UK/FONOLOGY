'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import {
  formatGBP,
  orderInputSchema,
  ukPostcodeSchema,
  type OrderInput,
  type OrderVerification,
} from '@/lib/data/types';
import { DELIVERY_OPTIONS } from '@/lib/config';
import { StripePaymentSection, type StartedPayment } from './stripe-payment';
import { useCartStore, selectSubtotal } from '@/lib/stores/cart.store';
import { useCheckoutStore } from '@/lib/stores/checkout.store';
import {
  useCreateOrder,
  useCreatePaymentIntent,
  useDeliveryQuote,
} from '@/lib/data/hooks/use-orders';
import { Spark } from '@/components/storefront/art';
import { addressShort } from '@/lib/data/types';
import { useShopDetails } from '@/lib/data/hooks';

type Step = 'details' | 'verify' | 'pay';

/**
 * Field name -> what the customer sees it called on the form. Only used to
 * make a validation failure at the payment step actionable: "Enter a valid UK
 * postcode - go back and check Postcode" beats a bare schema message.
 */
const FIELD_LABELS: Record<string, string> = {
  lines: 'your bag',
  email: 'Email',
  firstName: 'First name',
  lastName: 'Last name',
  phone: 'Phone',
  delivery: 'Delivery',
  address: 'Address',
  postcode: 'Postcode',
  paymentMethod: 'the payment method',
  verification: 'your uploaded documents',
};

/**
 * "Thursday 30 July" — a date a customer can act on, not an ISO string.
 * Parsed as a plain calendar date, so it never shifts a day for a visitor in
 * another timezone.
 */
function formatArrival(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** "2pm" from the settings value "14:00:00". */
function formatCutoff(time: string | null | undefined): string {
  if (!time) return '2pm';
  const [h] = time.split(':').map(Number);
  if (h === undefined || Number.isNaN(h)) return '2pm';
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${suffix}`;
}

export function CheckoutFlow() {
  const router = useRouter();
  const { data: shop } = useShopDetails();
  const params = useSearchParams();

  const lines = useCartStore((s) => s.lines);
  const subtotal = useCartStore(selectSubtotal);
  const clearCart = useCartStore((s) => s.clear);

  const co = useCheckoutStore();
  const createOrder = useCreateOrder();
  const createPaymentIntent = useCreatePaymentIntent();

  /**
   * The order this checkout has already created, if any.
   *
   * A declined card must NOT produce a second order when the customer tries
   * again, so the created order is remembered and reused. It is keyed on a
   * signature of everything that affects the price — change the basket, the
   * delivery method or the address and the cached order is genuinely the wrong
   * one, so a new one is created. Anything left behind stays `pending`, which
   * is what a pending order is for.
   */
  const placed = useRef<{ signature: string; reference: string; email: string } | null>(null);

  const hasPlate = lines.some((l) => l.kind === 'plate');
  const steps: Step[] = useMemo(
    () => (hasPlate ? ['details', 'verify', 'pay'] : ['details', 'pay']),
    [hasPlate],
  );
  const requested = (params.get('step') as Step) ?? 'details';

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [regDoc, setRegDoc] = useState('');
  const [licence, setLicence] = useState('');

  /**
   * Which step the customer may actually be on — not merely which step they
   * asked for.
   *
   * THE BUG THIS FIXES
   * The old rule was `steps.includes(requested) ? requested : 'details'`: it
   * checked the step EXISTS, never that the steps before it were done. With a
   * number plate in the bag the flow is details -> verify -> pay, and the
   * order schema then requires both ID documents. But `regDoc`/`licence` are
   * ordinary component state, so ANY arrival at /checkout?step=pay that did
   * not walk through the verify step in this exact mount — a shared link, a
   * bookmark, a refresh on the payment step, or adding a plate to the bag
   * while already on it — had them empty.
   *
   * The customer therefore got a fully working payment form, typed in a real
   * card number, pressed Pay, and only then hit a validation failure for
   * documents they were never asked for. The old failure path made that worse
   * by bouncing them to `details`, which is the one step that was not wrong.
   *
   * So the guard is: you cannot stand on `pay` until the plate documents are
   * on file. Sending them to `verify` rather than `details` matters — verify
   * is the step that actually wants something from them. And because this is
   * derived rather than a redirect, uploading both documents moves them
   * straight on to payment with no further clicking.
   */
  const verifyComplete = !hasPlate || (regDoc.length > 0 && licence.length > 0);
  const step: Step = (() => {
    if (!steps.includes(requested)) return 'details';
    if (requested === 'pay' && !verifyComplete) return 'verify';
    return requested;
  })();
  // The real fee — same zone/rate logic create_order() will charge,
  // recalculated whenever the basket, speed or postcode changes. Never a
  // self-picked tier price: what's shown here is what gets charged.
  const quote = useDeliveryQuote(lines, co.delivery, co.postcode);
  const deliveryFee = co.delivery === 'collect' ? 0 : (quote.data?.deliveryFee ?? 0);
  // Round 3 #4.1c: no discount term any more — the promo code field is
  // gone (see its own removal note further down). `total` is just
  // subtotal + delivery, exactly what create_order() actually charges.
  const total = Math.max(0, subtotal + deliveryFee);

  const go = (s: Step) => router.push(`/checkout?step=${s}`, { scroll: true });
  const stepIndex = steps.indexOf(step);

  /* ---- empty bag ---- */
  if (lines.length === 0) {
    return (
      <section className="checkout-page">
        <div className="sf-empty container">
          <Spark variant="red" />
          <strong className="font-display text-ink text-2xl font-extrabold uppercase">
            Your bag’s empty
          </strong>
          <p className="text-muted max-w-sm text-sm">Add something from the shop to check out.</p>
          <Link href="/shop" className="btn btn--red">
            <span className="btn__label">Browse the shop</span>
            <span className="btn__arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </div>
      </section>
    );
  }

  /* ---- validation ---- */
  const validateDetails = (): boolean => {
    const errs: Record<string, string> = {};
    if (!co.email.includes('@')) errs.email = 'Enter a valid email';
    if (!co.firstName.trim()) errs.firstName = 'Enter your first name';
    if (!co.lastName.trim()) errs.lastName = 'Enter your last name';
    if (co.phone.trim().length < 7) errs.phone = 'Enter your phone number';
    if (co.delivery !== 'collect') {
      if (!co.address.trim()) errs.address = 'Enter your address';
      // Round 3 #4.1b: same format check the server enforces
      // (orderInputSchema/ukPostcodeSchema) — used to only run at final
      // submit, so a malformed postcode sailed through every step and only
      // failed deep in payment. Also wired to the field's own onBlur below,
      // so it surfaces the moment it's actually wrong, not just at Continue.
      if (!co.postcode.trim()) errs.postcode = 'Enter your postcode';
      else if (!ukPostcodeSchema.safeParse(co.postcode.trim()).success) {
        errs.postcode = 'Enter a valid UK postcode';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  /** Round 3 #4.1b: validates on blur, not just at Continue. */
  const validatePostcodeField = () => {
    if (co.delivery === 'collect') return;
    const value = co.postcode.trim();
    setErrors((prev) => {
      const next = { ...prev };
      if (!value) delete next.postcode;
      else if (!ukPostcodeSchema.safeParse(value).success)
        next.postcode = 'Enter a valid UK postcode';
      else delete next.postcode;
      return next;
    });
  };

  const onDetailsContinue = () => {
    if (validateDetails()) go(steps[stepIndex + 1] as Step);
  };

  const onVerifyContinue = () => {
    if (!regDoc || !licence) {
      setErrors({ verify: 'Please upload both documents' });
      return;
    }
    setErrors({});
    go('pay');
  };

  /**
   * Create the order, then ask the server for a payment intent against it.
   *
   * ORDER FIRST. The server prices the basket, derives the delivery fee from
   * the postcode and writes a `pending` order; the intent is then built from
   * that stored total. Nothing in this function sends an amount anywhere —
   * `total` below is only ever rendered.
   *
   * Throws on failure with the API's own message, because the API's message is
   * the useful one: "Only 2 left of one item in your bag", not "payment
   * failed". StripePaymentSection catches it and shows it.
   */
  const startPayment = async (): Promise<StartedPayment> => {
    const verification: OrderVerification | null = hasPlate
      ? { registrationDoc: regDoc, licence }
      : null;
    const input: OrderInput = {
      lines,
      email: co.email.trim(),
      firstName: co.firstName.trim(),
      lastName: co.lastName.trim(),
      phone: co.phone.trim(),
      delivery: co.delivery,
      address: co.delivery === 'collect' ? undefined : co.address.trim(),
      postcode: co.delivery === 'collect' ? undefined : co.postcode.trim(),
      paymentMethod: co.paymentMethod,
      verification,
    };
    const parsed = orderInputSchema.safeParse(input);
    if (!parsed.success) {
      /*
       * DO NOT NAVIGATE AWAY HERE.
       *
       * This used to call go('details') and then throw. Both things happened:
       * the throw set an error message on the payment step, and the navigation
       * immediately unmounted the payment step that was displaying it. The
       * customer saw their card form vanish, an error flash for a single
       * frame, and the details form come back with no explanation and no idea
       * which field was wrong — after they had already typed a card number in.
       *
       * The message is worth more than the redirect. Stay put, say exactly
       * which field is wrong, and let them use the Back button that is already
       * on this step. Zod's `path` gives us the field name, so the message can
       * name it rather than saying "check your details".
       */
      const issue = parsed.error.issues[0];
      const field = issue?.path?.[0];
      const label = typeof field === 'string' ? FIELD_LABELS[field] : undefined;
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.error('[checkout] order input failed validation:', parsed.error.issues);
      }
      throw new Error(
        label
          ? `${issue?.message ?? 'That value is not valid'} — go back and check ${label}.`
          : (issue?.message ?? 'Please go back and check your details.'),
      );
    }

    // Everything that can change the price. A retry after a decline reuses the
    // order; a changed basket does not.
    const signature = JSON.stringify({
      lines: lines.map((l) => [l.productId, l.quantity, l.unitPrice]),
      delivery: co.delivery,
      postcode: parsed.data.postcode ?? null,
    });

    let reference = placed.current?.signature === signature ? placed.current.reference : null;
    let email = placed.current?.signature === signature ? placed.current.email : '';

    if (!reference) {
      const order = await createOrder.mutateAsync(parsed.data);
      reference = order.reference;
      email = order.email;
      placed.current = { signature, reference, email };
    }

    const intent = await createPaymentIntent.mutateAsync({ reference, email });
    return { clientSecret: intent.clientSecret, reference, email };
  };

  /** Paid (or genuinely under way) — the basket's job is done. */
  const onPaid = (payment: StartedPayment) => {
    placed.current = null;
    clearCart();
    co.reset();
    router.replace(
      `/checkout/confirmation?ref=${encodeURIComponent(payment.reference)}&email=${encodeURIComponent(payment.email)}`,
    );
  };

  const fieldCls = (name: string) => (errors[name] ? 'field field--invalid' : 'field');

  return (
    <section className="checkout-page">
      <div className="container">
        <p className="eyebrow">Checkout</p>
        <h1 className="checkout-page__title">Almost yours.</h1>

        {/* step indicator */}
        <div className="co-steps">
          {steps.map((s, i) => {
            const label = s === 'details' ? 'Details' : s === 'verify' ? 'Verify' : 'Payment';
            const cls = [
              'co-steps__item',
              i === stepIndex && 'is-active',
              i < stepIndex && 'is-done',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <span key={s} style={{ display: 'contents' }}>
                {i > 0 ? <span className="co-steps__sep" /> : null}
                <span className={cls}>
                  <i>{i + 1}</i>
                  {label}
                </span>
              </span>
            );
          })}
        </div>

        <div className="checkout-page__grid">
          <div className="co-panel">
            {step === 'details' ? (
              <>
                <div className="co-guest">
                  <div>
                    <strong>Checking out as guest</strong>
                    <span>No account needed — you’re a minute from done.</span>
                  </div>
                  <Link href="/login?redirect=/checkout">Have an account? Sign in</Link>
                </div>

                <h2 className="co-block-title">Your details</h2>
                <div className="ck-form">
                  <label className={fieldCls('email')}>
                    <span>Email</span>
                    <input
                      type="email"
                      placeholder="alex@email.co.uk"
                      value={co.email}
                      onChange={(e) => co.set('email', e.target.value)}
                    />
                  </label>
                  <div className="wz-form__grid">
                    <label className={fieldCls('firstName')}>
                      <span>First name</span>
                      <input
                        type="text"
                        placeholder="Alex"
                        value={co.firstName}
                        onChange={(e) => co.set('firstName', e.target.value)}
                      />
                    </label>
                    <label className={fieldCls('lastName')}>
                      <span>Last name</span>
                      <input
                        type="text"
                        placeholder="Turner"
                        value={co.lastName}
                        onChange={(e) => co.set('lastName', e.target.value)}
                      />
                    </label>
                  </div>
                  <label className={fieldCls('phone')}>
                    <span>Phone</span>
                    <input
                      type="tel"
                      placeholder="07XXX XXXXXX"
                      value={co.phone}
                      onChange={(e) => co.set('phone', e.target.value)}
                    />
                  </label>
                </div>

                <h2 className="co-block-title">Delivery</h2>
                <div className="co-options">
                  {DELIVERY_OPTIONS.map((o) => {
                    // Collect is always free. For the currently-selected
                    // speed, show the real postcode-derived fee once known;
                    // otherwise "from £x" (standard-zone rate) as a hint —
                    // never a fixed price the customer might not actually
                    // be charged.
                    const isSelected = co.delivery === o.id;
                    const priceLabel =
                      o.id === 'collect'
                        ? 'Free'
                        : isSelected && quote.data
                          ? formatGBP(quote.data.deliveryFee)
                          : `from ${formatGBP(o.price)}`;
                    return (
                      <button
                        key={o.id}
                        className={isSelected ? 'co-option is-active' : 'co-option'}
                        onClick={() => co.set('delivery', o.id)}
                      >
                        <span className="co-option__radio" />
                        <span className="co-option__body">
                          <strong>{o.label}</strong>
                          <span>{o.detail}</span>
                        </span>
                        <span className="co-option__price">{priceLabel}</span>
                      </button>
                    );
                  })}
                </div>
                {/*
                  The date the shop will actually be held to, from the server:
                  it honours the 2pm cut-off in shop settings and skips
                  weekends, so a Friday afternoon order says Monday rather than
                  implying Saturday. Stated rather than left to the customer to
                  infer from "order before 2pm".
                */}
                {co.delivery !== 'collect' && quote.data?.arrivalDate ? (
                  <p className="ck-note" style={{ marginTop: 8 }}>
                    <strong>Estimated arrival {formatArrival(quote.data.arrivalDate)}.</strong>{' '}
                    {quote.data.afterCutoff
                      ? `Ordered after our ${formatCutoff(quote.data.cutoffTime)} cut-off, so it goes out ${formatArrival(quote.data.dispatchDate)}.`
                      : `Order in the next while and it leaves us ${formatArrival(quote.data.dispatchDate)}.`}{' '}
                    Working days only — we don’t post at weekends.
                  </p>
                ) : null}
                {co.delivery !== 'collect' && co.postcode.trim() && quote.data ? (
                  <p className="ck-note" style={{ marginTop: 8 }}>
                    {quote.data.zone === 'remote'
                      ? 'This postcode is in our remote delivery zone.'
                      : 'Standard delivery zone for this postcode.'}
                  </p>
                ) : null}

                {co.delivery !== 'collect' ? (
                  <div className="ck-form" style={{ marginTop: 18 }}>
                    <label className={fieldCls('address')}>
                      <span>Address</span>
                      <input
                        type="text"
                        placeholder="4 Cherry Lane, Yourtown"
                        value={co.address}
                        onChange={(e) => co.set('address', e.target.value)}
                      />
                    </label>
                    <label className={fieldCls('postcode')}>
                      <span>Postcode</span>
                      <input
                        type="text"
                        placeholder="YT1 2AB"
                        value={co.postcode}
                        onChange={(e) => co.set('postcode', e.target.value)}
                        onBlur={validatePostcodeField}
                      />
                      {errors.postcode ? (
                        <span className="field__error">{errors.postcode}</span>
                      ) : null}
                    </label>
                  </div>
                ) : null}

                <button
                  className="btn btn--red btn--full"
                  style={{ marginTop: 24 }}
                  onClick={onDetailsContinue}
                >
                  <span className="btn__label">Continue</span>
                  <span className="btn__arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </>
            ) : null}

            {step === 'verify' ? (
              <>
                <h2 className="co-block-title">Verify your number plate</h2>
                <p className="ck-note">
                  Number plates are road-traffic regulated, so we need to confirm you can register
                  this vehicle before we make them. Upload both documents below (PDF or photo).
                </p>
                <div className="co-options">
                  <label className={regDoc ? 'co-upload is-filled' : 'co-upload'}>
                    <span className="co-upload__icon" aria-hidden="true">
                      ⤒
                    </span>
                    <span className="co-upload__body">
                      <strong>{regDoc || 'V5C / V750 (or valid registration document)'}</strong>
                      <span>{regDoc ? 'Uploaded' : 'PDF or image'}</span>
                    </span>
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={(e) => setRegDoc(e.target.files?.[0]?.name ?? '')}
                    />
                  </label>
                  <label className={licence ? 'co-upload is-filled' : 'co-upload'}>
                    <span className="co-upload__icon" aria-hidden="true">
                      ⤒
                    </span>
                    <span className="co-upload__body">
                      <strong>{licence || 'Driving licence'}</strong>
                      <span>{licence ? 'Uploaded' : 'PDF or image'}</span>
                    </span>
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={(e) => setLicence(e.target.files?.[0]?.name ?? '')}
                    />
                  </label>
                </div>
                {errors.verify ? (
                  <p className="co-promo__msg is-error" style={{ marginTop: 10 }}>
                    {errors.verify}
                  </p>
                ) : null}

                <div className="co-privacy">
                  <Spark variant="red" />
                  <span>
                    <strong>Your documents are private.</strong> They’re admin-access only, used
                    solely to verify this plate, and permanently deleted after 30 days.
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
                  <button className="btn btn--ghost" onClick={() => go('details')}>
                    <span className="btn__label">← Back</span>
                  </button>
                  <button className="btn btn--red" style={{ flex: 1 }} onClick={onVerifyContinue}>
                    <span className="btn__label">Continue to payment</span>
                    <span className="btn__arrow" aria-hidden="true">
                      →
                    </span>
                  </button>
                </div>
              </>
            ) : null}

            {step === 'pay' ? (
              <>
                {/* Round 3 #4.1c: the promo code field is gone — it was
                    already dead (DEMO_CODES is intentionally empty, see
                    lib/data/promo.ts's own comment; every code showed "not
                    recognised"), and removing it here doesn't touch that
                    file — it stays for whenever a real promotion engine
                    exists to read from. */}
                <h2 className="co-block-title">Payment</h2>
                {/*
                  No provider radio here any more. The Payment Element IS the
                  method chooser — it shows exactly what the Stripe account has
                  enabled, so it can never offer something that would then
                  fail. Clearpay, if the client says yes and it is switched on
                  in the dashboard, appears inside this same component with no
                  code change (HANDOVER-PROJECT.md section 8, question 1).
                */}
                <StripePaymentSection
                  amount={total}
                  disabled={lines.length === 0}
                  /* Already given on the details step — don't ask twice, and
                     pin the billing country so Clearpay is actually offered. */
                  billing={{
                    name: `${co.firstName} ${co.lastName}`.trim(),
                    email: co.email.trim(),
                    phone: co.phone.trim(),
                    line1: co.delivery === 'collect' ? undefined : co.address.trim(),
                    postalCode: co.delivery === 'collect' ? undefined : co.postcode.trim(),
                  }}
                  onStart={startPayment}
                  onPaid={onPaid}
                />
                <button className="co-back" onClick={() => go(steps[stepIndex - 1] as Step)}>
                  ← Back
                </button>
              </>
            ) : null}
          </div>

          {/* SUMMARY */}
          <aside className="co-summary">
            <h2 className="co-summary__title">Your order</h2>
            {lines.map((l) => (
              <div className="co-line" key={l.productId}>
                <h4>{l.name}</h4>
                <strong>{formatGBP(l.unitPrice * l.quantity)}</strong>
                <span>
                  {l.sub} · ×{l.quantity}
                </span>
              </div>
            ))}
            <div className="co-totals">
              <div className="co-totals__row">
                <span>Subtotal</span>
                <span>{formatGBP(subtotal)}</span>
              </div>
              <div className="co-totals__row">
                <span>{co.delivery === 'collect' ? 'Collection' : 'Delivery'}</span>
                <span>{deliveryFee === 0 ? 'Free' : formatGBP(deliveryFee)}</span>
              </div>
              <div className="co-totals__row co-totals__row--total">
                <span>Total</span>
                <strong>{formatGBP(total)}</strong>
              </div>
            </div>
            <p className="ck-note" style={{ marginTop: 14, marginBottom: 0 }}>
              Free click &amp; collect from the counter · {addressShort(shop?.shopAddress ?? null)}
            </p>
            <Link className="co-back" href="/shop" style={{ display: 'inline-block' }}>
              ← Keep shopping
            </Link>
          </aside>
        </div>
      </div>
    </section>
  );
}
