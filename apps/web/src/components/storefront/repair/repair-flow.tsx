'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { EASE, gsap, registerGsap } from '@/lib/gsap';
import {
  formatGBP,
  bookingInputSchema,
  type BookingInput,
  type ContactMethod,
  type PartTierId,
} from '@/lib/data/types';
import {
  useDevices,
  useRepairTypes,
  usePartTiers,
  useRepairQuote,
  useTierQuotes,
  useFromQuotes,
  useCreateBooking,
} from '@/lib/data/hooks/use-repair';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { useMagnetic } from '@/lib/hooks/use-magnetic';
import { useSmoothScroll } from '@/components/storefront/smooth-scroll';
import { wizardStageOffset } from '@/lib/wizard-scroll';
import { DeviceGlyph, RepairIcon } from '@/components/storefront/art';

const BRAND_LABEL: Record<string, string> = {
  apple: 'Apple',
  samsung: 'Samsung',
  pixel: 'Google',
  other: 'Any make',
};

type TierValue = PartTierId | 'diag' | null;

/**
 * Bug fix (post-"final pass" report #3): this used to compare `repair`
 * (which holds a repair_types.id, a real uuid) against the literal string
 * 'other' — a comparison that could never be true, so the free-text "Tell
 * us what's wrong" box below was unreachable dead code no matter which
 * tile a customer picked. Unlike the device step, repair types have no
 * brand-style category column to key off, so the fix is a real seeded
 * catch-all row (`0067_seed_other_repair_type.sql` — "Something else",
 * free diagnosis pricing) at this fixed id, matched here the same way the
 * id-based lookups elsewhere in this file already work.
 */
const OTHER_REPAIR_ID = '00000000-0000-0000-0000-0000000b5099';

export function RepairFlow() {
  const params = useSearchParams();
  const { reduced } = useEnvironment();
  const { scrollTo } = useSmoothScroll();
  const confirmRef = useMagnetic<HTMLButtonElement>();

  const { data: devices } = useDevices();
  const { data: repairs } = useRepairTypes();
  const { data: tiers } = usePartTiers();
  const createBooking = useCreateBooking();

  const [device, setDevice] = useState<string | null>(null);
  const [repair, setRepair] = useState<string | null>(null);
  const [tier, setTier] = useState<TierValue>(null);
  const [deviceOther, setDeviceOther] = useState('');
  const [faultText, setFaultText] = useState('');
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    postcode: '',
    preferredContact: 'phone' as ContactMethod,
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [reference, setReference] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const priceRef = useRef<HTMLSpanElement>(null);
  const formPriceRef = useRef<HTMLSpanElement>(null);
  const shownPrice = useRef(0);

  const dev = devices?.find((d) => d.id === device);
  const rep = repairs?.find((r) => r.id === repair);
  const isDiagnosis = rep ? rep.base === null : false;

  // Deep-link from the homepage quick quote (?device=&repair=).
  useEffect(() => {
    if (!devices || !repairs) return;
    const pd = params.get('device');
    const pr = params.get('repair');
    let step = 0;
    if (pd && devices.some((d) => d.id === pd)) {
      setDevice(pd);
      step = 1;
    }
    if (pr && repairs.some((r) => r.id === pr)) {
      setRepair(pr);
      step = 2;
    }
    if (step > 0) {
      setCurrent(step);
      setMaxReached(step);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, repairs]);

  /* ---- price — always server-quoted, never recomputed client-side ---- */
  const effectiveTierId = tier && tier !== 'diag' ? tier : 'copy';
  const quote = useRepairQuote(
    dev && rep && rep.base !== null
      ? { deviceId: dev.id, repairId: rep.id, tierId: effectiveTierId }
      : undefined,
  );
  const tierQuotes = useTierQuotes(dev?.id, rep?.id);
  const fromQuotes = useFromQuotes(
    dev?.id,
    (repairs ?? []).map((r) => r.id),
  );

  const priceVal: number | null =
    !dev || !rep ? null : rep.base === null ? (tier ? 0 : null) : (quote.data?.price ?? null);
  const isFrom = !tier && !isDiagnosis;

  useEffect(() => {
    const el = priceRef.current;
    const fEl = formPriceRef.current;
    const write = (v: number) => {
      const txt =
        priceVal === 0 ? '£0' : `${isFrom ? 'from ' : ''}${formatGBP(Math.round(v / 100) * 100)}`;
      if (el) el.textContent = priceVal == null ? '£ —' : txt;
      if (fEl) fEl.textContent = priceVal == null ? '£ —' : priceVal === 0 ? '£0 today' : txt;
    };
    if (priceVal == null) {
      write(0);
      return;
    }
    if (reduced) {
      shownPrice.current = priceVal;
      write(priceVal);
      return;
    }
    // Paint the real (now server-quoted, arrives async) value immediately —
    // correctness can't depend on a requestAnimationFrame tick actually
    // landing. The tween below is a pure visual flourish on top of that.
    write(priceVal);
    const obj = { v: shownPrice.current };
    const tween = gsap.to(obj, {
      v: priceVal,
      duration: 0.6,
      ease: 'power2.out',
      onUpdate: () => write(obj.v),
      onComplete: () => {
        shownPrice.current = priceVal;
      },
    });
    return () => {
      tween.kill();
    };
  }, [priceVal, isFrom, reduced]);

  /* ---- step transitions (port of repair.js goTo) ---- */
  const goTo = (i: number, dir = 1) => {
    const stage = stageRef.current;
    setCurrent(i);
    setMaxReached((m) => Math.max(m, i));
    // Land on the new question, not the top of the page — see wizard-scroll.ts
    // for why `scrollTo(0)` made every mobile step a scroll back down.
    if (stage) scrollTo(stage, { offset: wizardStageOffset() });
    if (!stage || reduced) return;
    registerGsap();
    const to = stage.querySelector(`[data-wz="${i}"]`);
    if (to) {
      gsap.fromTo(
        to.querySelectorAll('.wz-head, .dcard, .ocard, .tcard, .wz-form > *, .wz-done > *'),
        { y: 34 * dir, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.6,
          stagger: 0.045,
          ease: EASE.expo,
          clearProps: 'transform',
        },
      );
    }
  };

  const selectDevice = (id: string) => {
    setDevice(id);
    setTier(null);
    const brand = devices?.find((d) => d.id === id)?.brand;
    if (brand !== 'other') setTimeout(() => goTo(1), reduced ? 0 : 220);
  };
  const selectRepair = (id: string) => {
    setRepair(id);
    setTier(null);
    if (id !== OTHER_REPAIR_ID) setTimeout(() => goTo(2), reduced ? 0 : 220);
  };
  const selectTier = (id: TierValue) => {
    setTier(id);
    setTimeout(() => goTo(3), reduced ? 0 : 220);
  };

  /* ---- submit (mail-in) ---- */
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const extraNotes = [
      dev?.brand === 'other' && deviceOther ? `Device: ${deviceOther}` : '',
      repair === OTHER_REPAIR_ID && faultText ? `Fault: ${faultText}` : '',
      form.notes,
    ]
      .filter(Boolean)
      .join(' · ');

    const input: BookingInput = {
      deviceId: device ?? '',
      repairId: repair ?? '',
      tierId: tier === 'diag' ? null : tier,
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      postcode: form.postcode.trim(),
      preferredContact: form.preferredContact,
      notes: extraNotes || undefined,
    };

    const parsed = bookingInputSchema.safeParse(input);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        if (!errs[key]) errs[key] = issue.message;
      }
      setErrors(errs);
      const firstBad = document.querySelector<HTMLElement>('.field--invalid input');
      firstBad?.focus();
      return;
    }
    setErrors({});
    createBooking.mutate(parsed.data, {
      onSuccess: (booking) => {
        setReference(booking.reference);
        goTo(4);
        if (!reduced) setTimeout(confettiBurst, 350);
      },
    });
  };

  const confettiBurst = () => {
    const wrap = document.getElementById('rp-confetti');
    if (!wrap) return;
    const colors = ['#E8250C', '#FF5A2E', '#AE1A06', '#181010', '#F3EAE3'];
    for (let i = 0; i < 42; i++) {
      const el = document.createElement('i');
      el.className = 'cf';
      el.style.background = colors[i % colors.length] ?? '#E8250C';
      el.style.left = `${30 + Math.random() * 40}%`;
      wrap.appendChild(el);
      gsap.fromTo(
        el,
        { y: 40, x: 0, rotate: 0, autoAlpha: 1 },
        {
          y: 260 + Math.random() * 360,
          x: (Math.random() - 0.5) * 440,
          rotate: (Math.random() - 0.5) * 720,
          autoAlpha: 0,
          duration: 1.6 + Math.random() * 1.2,
          ease: 'power1.out',
          delay: Math.random() * 0.25,
          onComplete: () => el.remove(),
        },
      );
    }
  };

  const railItems = [
    { label: 'Your phone', value: dev?.name ?? 'Pick a model' },
    { label: 'The problem', value: rep?.name ?? '—' },
    {
      label: 'Part grade',
      value: tier === 'diag' ? 'Diagnosis first' : (tiers?.find((t) => t.id === tier)?.name ?? '—'),
    },
    { label: 'Your details', value: form.name ? form.name : '—' },
  ];

  const fieldCls = (name: string) => (errors[name] ? 'field field--invalid' : 'field');

  return (
    <section className="wizard">
      <div className="wizard__grid container">
        {/* RAIL */}
        <aside className="wizard__rail" id="wizardRail">
          <p className="eyebrow">Repair request — about a minute</p>
          <h1 className="wizard__title" aria-label="Let's get it fixed.">
            <span className="h-mask">
              <span className="h-line">LET’S GET IT</span>
            </span>
            <span className="h-mask">
              <span className="h-line">
                <em>fixed.</em>
              </span>
            </span>
          </h1>

          <ol className="rail" id="rail">
            {railItems.map((item, i) => {
              const done =
                i < current ||
                (i === 0 && !!device && current !== 0) ||
                (i === 1 && !!repair && current > 1) ||
                (i === 2 && !!tier && current > 2);
              const cls = ['rail__item', i === current && 'is-active', done && 'is-done']
                .filter(Boolean)
                .join(' ');
              return (
                <li
                  key={item.label}
                  className={cls}
                  data-cursor
                  onClick={() => {
                    if (i <= maxReached && current !== 4) goTo(i, i < current ? -1 : 1);
                  }}
                >
                  <i>{String(i + 1).padStart(2, '0')}</i>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.value}</span>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="rail__price" id="railPrice">
            <span className="rail__price-cap">Your price so far</span>
            <strong ref={priceRef}>£ —</strong>
            <em>{tier ? 'fitted · tested · warrantied' : 'cheapest grade — pick yours next'}</em>
          </div>

          <p className="rail__reassure">
            Pay nothing now — you pay after we’ve diagnosed it and you’ve approved the price.
          </p>
        </aside>

        {/* STAGE */}
        <div className="wizard__stage" id="stage" ref={stageRef}>
          {/* STEP 1 — device */}
          <section className={current === 0 ? 'wz-step is-active' : 'wz-step'} data-wz={0}>
            <header className="wz-head">
              <span className="wz-no">01 / 04</span>
              <h2>
                Which phone are we <em>saving?</em>
              </h2>
            </header>
            <div className="device-grid">
              {(devices ?? []).map((d) => (
                <button
                  key={d.id}
                  className={device === d.id ? 'dcard is-selected' : 'dcard'}
                  onClick={() => selectDevice(d.id)}
                >
                  <span className="dcard__check">✓</span>
                  <DeviceGlyph brand={d.brand} className="dcard__glyph" />
                  <span className="dcard__name">{d.name}</span>
                  <span className="dcard__hint">{BRAND_LABEL[d.brand]}</span>
                </button>
              ))}
            </div>
            {dev?.brand === 'other' ? (
              <label className="field" style={{ marginTop: 18, maxWidth: 420 }}>
                <span>Which phone? (optional)</span>
                <input
                  type="text"
                  placeholder="e.g. OnePlus 12, Motorola Edge…"
                  value={deviceOther}
                  onChange={(e) => setDeviceOther(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--ink btn--sm"
                  style={{ marginTop: 14 }}
                  onClick={() => goTo(1)}
                >
                  <span className="btn__label">Continue</span>
                  <span className="btn__arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </label>
            ) : null}
          </section>

          {/* STEP 2 — problem */}
          <section className={current === 1 ? 'wz-step is-active' : 'wz-step'} data-wz={1}>
            <header className="wz-head">
              <button className="wz-back" onClick={() => goTo(0, -1)} data-cursor>
                ← Back
              </button>
              <span className="wz-no">02 / 04</span>
              <h2>
                What’s it doing — <em>or not doing?</em>
              </h2>
            </header>
            <div className="repair-grid">
              {(repairs ?? []).map((r) => {
                const from = dev && r.base ? (fromQuotes[r.id] ?? null) : null;
                return (
                  <button
                    key={r.id}
                    className={repair === r.id ? 'ocard is-selected' : 'ocard'}
                    onClick={() => selectRepair(r.id)}
                  >
                    <span className="dcard__check">✓</span>
                    <RepairIcon id={r.id} className="ocard__icon" />
                    <span className="ocard__name">{r.name}</span>
                    <span className="ocard__desc">{r.desc}</span>
                    <span className="ocard__meta">
                      <span>{r.time}</span>
                      <span className="ocard__from">
                        {from != null ? `from ${formatGBP(from)}` : '£0 to look'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {repair === OTHER_REPAIR_ID ? (
              <label className="field" style={{ marginTop: 18, maxWidth: 520 }}>
                <span>Tell us what’s wrong</span>
                <textarea
                  rows={2}
                  placeholder="e.g. speaker crackles, camera won’t focus, buttons stuck…"
                  value={faultText}
                  onChange={(e) => setFaultText(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--ink btn--sm"
                  style={{ marginTop: 14 }}
                  onClick={() => goTo(2)}
                >
                  <span className="btn__label">Continue</span>
                  <span className="btn__arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </label>
            ) : null}
          </section>

          {/* STEP 3 — part grade */}
          <section className={current === 2 ? 'wz-step is-active' : 'wz-step'} data-wz={2}>
            <header className="wz-head">
              <button className="wz-back" onClick={() => goTo(1, -1)} data-cursor>
                ← Back
              </button>
              <span className="wz-no">03 / 04</span>
              <h2>
                Pick your <em>part grade.</em>
              </h2>
              <p className="wz-hint">
                Same fitting, same testing, same care — the part is the only difference. We’ll
                happily advise once we’ve seen it.
              </p>
            </header>
            <div className="tier-grid">
              {isDiagnosis ? (
                <button
                  className={
                    tier === 'diag' ? 'tcard tcard--diag is-selected' : 'tcard tcard--diag'
                  }
                  onClick={() => selectTier('diag')}
                >
                  <span className="dcard__check">✓</span>
                  <div>
                    <span className="tcard__tier">Free diagnosis</span>
                    <p className="tcard__line">
                      {/* Client-readiness report: "Post it in" — same
                          unbacked mail-in framing as the rest of this
                          wizard, fixed the same way and for the same
                          reason. See wz-done__note's own comment below. */}
                      We’ll find the fault, then quote you before touching anything else. If you
                      walk away, it costs nothing.
                    </p>
                  </div>
                  <span className="tcard__price">£0</span>
                </button>
              ) : (
                (tiers ?? []).map((t) => (
                  <button
                    key={t.id}
                    className={[
                      'tcard',
                      t.id === 'oem' && 'tcard--rec',
                      tier === t.id && 'is-selected',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => selectTier(t.id)}
                  >
                    <span className="dcard__check">✓</span>
                    <span className="tcard__tier">{t.name}</span>
                    <span className="tcard__price">
                      {dev && rep ? formatGBP(tierQuotes.prices[t.id] ?? 0) : '—'}
                    </span>
                    <p className="tcard__line">{t.line}</p>
                    <span className="tcard__badge">{t.warranty}</span>
                  </button>
                ))
              )}
            </div>
          </section>

          {/* STEP 4 — YOUR DETAILS. Was labelled "(mail-in)" (see this
              section's own old comment, and "submit (mail-in)" further
              down) and its heading/hint promised a mail-in repair with a
              prepaid shipping label — same false-promise class as
              wz-done__note below (client-readiness report), earlier and
              more prominent: this is what the customer sees BEFORE they
              even submit. Neither repairs.routes.ts nor anything else in
              this codebase has a courier/tracking concept or an email
              sender for repairs, so nothing backed this regardless of
              which physical process the shop actually uses — corrected to
              copy that's honest without guessing at that process. */}
          <section className={current === 3 ? 'wz-step is-active' : 'wz-step'} data-wz={3}>
            <header className="wz-head">
              <button className="wz-back" onClick={() => goTo(2, -1)} data-cursor>
                ← Back
              </button>
              <span className="wz-no">04 / 04</span>
              <h2>
                Your <em>details.</em>
              </h2>
              <p className="wz-hint">
                Last step — how should we reach you, and where should we send the estimate?
              </p>
            </header>
            <form className="wz-form" onSubmit={submit} noValidate>
              <div className="wz-form__grid">
                <label className={fieldCls('name')}>
                  <span>Your name</span>
                  <input
                    type="text"
                    placeholder="Alex Turner"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label className={fieldCls('phone')}>
                  <span>Mobile number</span>
                  <input
                    type="tel"
                    placeholder="07XXX XXXXXX"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                  {errors.phone ? <span className="field__error">{errors.phone}</span> : null}
                </label>
                <label className={fieldCls('email')}>
                  <span>Email</span>
                  <input
                    type="email"
                    placeholder="alex@email.co.uk"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </label>
                <label className={fieldCls('postcode')}>
                  <span>Postcode</span>
                  <input
                    type="text"
                    placeholder="YT1 2AB"
                    value={form.postcode}
                    onChange={(e) => setForm({ ...form, postcode: e.target.value })}
                  />
                  {errors.postcode ? <span className="field__error">{errors.postcode}</span> : null}
                </label>
              </div>
              <label className={fieldCls('address')}>
                <span>Address</span>
                <input
                  type="text"
                  placeholder="4 Cherry Lane, Yourtown"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </label>

              <div className="wz-slots">
                <span className="field__cap">Preferred contact</span>
                <div className="slot-row">
                  {(['phone', 'email'] as ContactMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={form.preferredContact === m ? 'slot is-active' : 'slot'}
                      onClick={() => setForm({ ...form, preferredContact: m })}
                    >
                      {m === 'phone' ? 'Text / call' : 'Email'}
                    </button>
                  ))}
                </div>
              </div>

              <label className="field field--area">
                <span>Anything we should know? (optional)</span>
                <textarea
                  rows={2}
                  placeholder="e.g. back glass is cracked too, data is precious, it’s been in the sea…"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>

              <div className="wz-form__foot">
                <div className="wz-form__price">
                  <span>Estimated total</span>
                  <strong ref={formPriceRef}>£ —</strong>
                </div>
                <button
                  type="submit"
                  className="btn btn--red btn--lg"
                  ref={confirmRef}
                  disabled={createBooking.isPending}
                >
                  <span className="btn__label">
                    {createBooking.isPending ? 'Starting…' : 'Start my repair'}
                  </span>
                  <span className="btn__arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </div>
              {/* Bug fix (post-"final pass" report #7): submission failures
                  — including the API's new staff-checkout block — went
                  nowhere before this; the button just silently did
                  nothing. */}
              {createBooking.isError ? (
                <p className="wz-form__missing" role="alert">
                  {createBooking.error?.message || 'Could not start that repair — try again.'}
                </p>
              ) : null}
              <p className="wz-form__legal">
                {/* Client-readiness report: same unbacked "prepaid shipping
                    label" promise as the rest of this wizard — see
                    wz-done__note's own comment below for the full reasoning. */}
                Submitting sends this to us for real, with a trackable reference — we’ll follow up
                to arrange next steps.
              </p>
            </form>
          </section>

          {/* SUCCESS */}
          <section
            className={current === 4 ? 'wz-step wz-step--done is-active' : 'wz-step wz-step--done'}
            data-wz={4}
          >
            <div className="wz-done">
              <div className="wz-done__confetti" id="rp-confetti" aria-hidden="true" />
              <svg className="ck-tick" viewBox="0 0 96 96" aria-hidden="true">
                <circle className="ck-tick__ring" cx="48" cy="48" r="42" />
                <path className="ck-tick__check" d="M30 50 L43 63 L67 36" />
              </svg>
              <h2 className="wz-done__title">
                Request in. <em>Breathe out.</em>
              </h2>
              <p className="wz-done__ref">
                Reference <strong>{reference ?? 'FNL-0000'}</strong>
              </p>
              <div className="wz-done__card">
                <div className="done-row">
                  <span>Phone</span>
                  <strong>{dev?.name ?? '—'}</strong>
                </div>
                <div className="done-row">
                  <span>Repair</span>
                  <strong>{rep?.name ?? '—'}</strong>
                </div>
                <div className="done-row">
                  <span>Part grade</span>
                  <strong>
                    {tier === 'diag'
                      ? 'Diagnosis first'
                      : (tiers?.find((t) => t.id === tier)?.name ?? '—')}
                  </strong>
                </div>
                <div className="done-row">
                  <span>Contact</span>
                  <strong>{form.preferredContact === 'phone' ? 'Text / call' : 'Email'}</strong>
                </div>
                <div className="done-row done-row--price">
                  <span>Estimate</span>
                  <strong>
                    {priceVal === 0
                      ? '£0 — quote first'
                      : priceVal != null
                        ? formatGBP(priceVal)
                        : '—'}
                  </strong>
                </div>
              </div>
              <p className="wz-done__note">
                {/* Client-readiness report: this used to promise a prepaid
                    shipping label, unconditionally, on every booking. Not
                    just this line — "Post it in" (tier card), "This is a
                    mail-in repair" (step 4's own header), and "we'll follow
                    up with a prepaid shipping label" (the legal line above
                    the submit button) all made the same promise, and the
                    code's own comments ("STEP 4 — YOUR DETAILS (mail-in)",
                    "submit (mail-in)") show it was a deliberate, designed
                    mail-in feature, not a copy accident — repairs.routes.ts
                    has no courier/tracking columns the way orders does, and
                    sendTransactionalEmail's only call site is trade-in
                    acceptance, so nothing here was ever wired to a real
                    label or a real email. Whether this shop's real process
                    is walk-in, mail-in, or both isn't something to guess at
                    from the code — corrected to what's actually true
                    regardless: the booking is real, and a human follows up
                    by the contact method chosen, not an automated system. */}
                Your booking is confirmed — quote this reference either way. We’ll be in touch by{' '}
                {form.preferredContact === 'phone' ? 'phone' : 'email'} to arrange next steps.
              </p>
              {/* Round 5 #32: tracking is for product purchases only —
                  dropped the link to /track here (it also wasn't the sell
                  form's actual problem — this pairs with that fix, not
                  because this one was broken, but to keep the policy
                  consistent across every confirmation screen). */}
              <div className="wz-done__actions">
                <Link href="/shop" className="btn btn--ink">
                  <span className="btn__label">Browse the shop while you wait</span>
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
