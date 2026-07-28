'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  formatGBP,
  orderInputSchema,
  type OrderInput,
  type OrderVerification,
} from '@/lib/data/types';
import { DELIVERY_OPTIONS } from '@/lib/config';
import { applyPromo, isValidPromo } from '@/lib/data/promo';
import {
  PAYMENT_PROVIDERS,
  getPaymentProvider,
  type PaymentMethodId,
} from '@/lib/payments/provider';
import { useCartStore, selectSubtotal } from '@/lib/stores/cart.store';
import { useCheckoutStore } from '@/lib/stores/checkout.store';
import { useCreateOrder, useDeliveryQuote } from '@/lib/data/hooks/use-orders';
import { Spark } from '@/components/storefront/art';
import { CONTACT } from '@/lib/site';

type Step = 'details' | 'verify' | 'pay';

export function CheckoutFlow() {
  const router = useRouter();
  const params = useSearchParams();

  const lines = useCartStore((s) => s.lines);
  const subtotal = useCartStore(selectSubtotal);
  const clearCart = useCartStore((s) => s.clear);

  const co = useCheckoutStore();
  const createOrder = useCreateOrder();

  const hasPlate = lines.some((l) => l.kind === 'plate');
  const steps: Step[] = useMemo(
    () => (hasPlate ? ['details', 'verify', 'pay'] : ['details', 'pay']),
    [hasPlate],
  );
  const requested = (params.get('step') as Step) ?? 'details';
  const step: Step = steps.includes(requested) ? requested : 'details';

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [regDoc, setRegDoc] = useState('');
  const [licence, setLicence] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [paying, setPaying] = useState(false);

  // The real fee — same zone/rate logic create_order() will charge,
  // recalculated whenever the basket, speed or postcode changes. Never a
  // self-picked tier price: what's shown here is what gets charged.
  const quote = useDeliveryQuote(lines, co.delivery, co.postcode);
  const deliveryFee = co.delivery === 'collect' ? 0 : (quote.data?.deliveryFee ?? 0);
  const discount = promoApplied ? applyPromo(co.promoCode, subtotal) : 0;
  const total = Math.max(0, subtotal + deliveryFee - discount);

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
      if (!co.postcode.trim()) errs.postcode = 'Enter your postcode';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
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

  const onApplyPromo = () => {
    if (isValidPromo(co.promoCode)) {
      setPromoApplied(true);
      setPromoMsg({ ok: true, text: 'Code applied.' });
    } else {
      setPromoApplied(false);
      setPromoMsg({ ok: false, text: 'That code isn’t recognised.' });
    }
  };

  const onPay = async () => {
    setPaying(true);
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
      promoCode: promoApplied ? co.promoCode : undefined,
      verification,
    };
    const parsed = orderInputSchema.safeParse(input);
    if (!parsed.success) {
      setPaying(false);
      go('details');
      return;
    }
    const result = await getPaymentProvider(co.paymentMethod).pay(total);
    if (!result.ok) {
      setPaying(false);
      return;
    }
    createOrder.mutate(parsed.data, {
      onSuccess: (order) => {
        clearCart();
        co.reset();
        router.replace(
          `/checkout/confirmation?ref=${encodeURIComponent(order.reference)}&email=${encodeURIComponent(order.email)}`,
        );
      },
      onError: () => setPaying(false),
    });
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
                      />
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
                <h2 className="co-block-title">Discount code</h2>
                <div className="co-promo">
                  <input
                    type="text"
                    placeholder="Promo code"
                    value={co.promoCode}
                    onChange={(e) => {
                      co.set('promoCode', e.target.value);
                      setPromoApplied(false);
                      setPromoMsg(null);
                    }}
                  />
                  <button className="btn btn--ink" onClick={onApplyPromo}>
                    <span className="btn__label">Apply</span>
                  </button>
                </div>
                {promoMsg ? (
                  <p className={promoMsg.ok ? 'co-promo__msg is-ok' : 'co-promo__msg is-error'}>
                    {promoMsg.text}
                  </p>
                ) : null}

                <h2 className="co-block-title">Payment</h2>
                <div className="co-options">
                  {Object.values(PAYMENT_PROVIDERS).map((p) => (
                    <button
                      key={p.id}
                      className={co.paymentMethod === p.id ? 'co-option is-active' : 'co-option'}
                      onClick={() => co.set('paymentMethod', p.id as PaymentMethodId)}
                    >
                      <span className="co-option__radio" />
                      <span className="co-option__body">
                        <strong>{p.label}</strong>
                        <span>{p.blurb}</span>
                      </span>
                    </button>
                  ))}
                </div>

                {co.paymentMethod === 'stripe' ? (
                  <div className="ck-card" style={{ marginTop: 18 }}>
                    <div className="ck-card__chip" />
                    <span className="ck-card__num">
                      4242&nbsp;&nbsp;4242&nbsp;&nbsp;4242&nbsp;&nbsp;4242
                    </span>
                    <div className="ck-card__row">
                      <span>FONOLOGY DEMO</span>
                      <span>12/29</span>
                    </div>
                  </div>
                ) : null}
                <p className="ck-note">
                  This is a design prototype — no real payment is taken. Payment is abstracted
                  behind a provider interface so a real Stripe / Clearpay SDK drops in later.
                </p>

                <button
                  className={paying ? 'btn btn--red btn--full is-busy' : 'btn btn--red btn--full'}
                  onClick={onPay}
                  disabled={paying || createOrder.isPending}
                >
                  <span className="btn__label">Pay {formatGBP(total)}</span>
                </button>
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
              {discount > 0 ? (
                <div className="co-totals__row co-totals__row--discount">
                  <span>Discount</span>
                  <span>−{formatGBP(discount)}</span>
                </div>
              ) : null}
              <div className="co-totals__row co-totals__row--total">
                <span>Total</span>
                <strong>{formatGBP(total)}</strong>
              </div>
            </div>
            <p className="ck-note" style={{ marginTop: 14, marginBottom: 0 }}>
              Free click &amp; collect from the counter · {CONTACT.addressShort}
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
