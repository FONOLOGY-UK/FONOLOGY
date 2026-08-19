'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { EASE, gsap, registerGsap } from '@/lib/gsap';
import {
  sellRequestInputSchema,
  type SellCondition,
  type SellRequestInput,
  type ContactMethod,
  type ScreenCondition,
  type BodyCondition,
  type NetworkStatus,
} from '@/lib/data/types';
import { useDevices } from '@/lib/data/hooks/use-repair';
import { useCreateSellRequest } from '@/lib/data/hooks/use-sell';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { useMagnetic } from '@/lib/hooks/use-magnetic';
import { useSmoothScroll } from '@/components/storefront/smooth-scroll';
import { wizardStageOffset } from '@/lib/wizard-scroll';
import { DeviceGlyph, Spark } from '@/components/storefront/art';

const BRAND_LABEL: Record<string, string> = {
  apple: 'Apple',
  samsung: 'Samsung',
  pixel: 'Google',
  other: 'Any make',
};
const STORAGE = ['64GB', '128GB', '256GB', '512GB', '1TB'];
const SCREEN: { id: ScreenCondition; label: string }[] = [
  { id: 'flawless', label: 'Flawless' },
  { id: 'good', label: 'Light marks' },
  { id: 'cracked', label: 'Cracked' },
];
const BODY: { id: BodyCondition; label: string }[] = [
  { id: 'flawless', label: 'Flawless' },
  { id: 'good', label: 'Light wear' },
  { id: 'worn', label: 'Heavy wear' },
];
const ACCESSORIES = ['Box', 'Charger', 'Cable'];

/**
 * The condition answers that are actually required, in the order they appear
 * on screen. Accessories are deliberately absent — that group is optional and
 * says so.
 *
 * Driving both the validation and the "you still need to answer this" markers
 * off ONE list is the point: the old code had the rule buried in a
 * `conditionComplete` boolean that only ever fed a `disabled` attribute, so
 * there was nothing to tell the shopper WHICH answer was missing.
 */
type CondKey = 'storage' | 'screen' | 'body' | 'powersOn' | 'network';
const REQUIRED_CONDITION: { key: CondKey; label: string }[] = [
  { key: 'storage', label: 'Storage' },
  { key: 'screen', label: 'Screen condition' },
  { key: 'body', label: 'Body condition' },
  { key: 'powersOn', label: 'Does it power on?' },
  { key: 'network', label: 'Network' },
];

/** The per-group "you skipped this" line. Nothing renders until flagged. */
function MissingNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="wz-slots__missing">Pick one to carry on</span>;
}

export function SellFlow() {
  const { reduced } = useEnvironment();
  const { scrollTo } = useSmoothScroll();
  const submitRef = useMagnetic<HTMLButtonElement>();
  const { data: devices } = useDevices();
  const createSell = useCreateSellRequest();

  const [device, setDevice] = useState<string | null>(null);
  const [deviceOther, setDeviceOther] = useState('');
  const [cond, setCond] = useState<Partial<SellCondition>>({ accessories: [] });
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    preferredContact: 'phone' as ContactMethod,
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [reference, setReference] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const dev = devices?.find((d) => d.id === device);

  /** Which required groups are still unanswered, in on-screen order. */
  const missingCondition = REQUIRED_CONDITION.filter(({ key }) =>
    key === 'powersOn' ? cond.powersOn === undefined : !cond[key],
  );
  const conditionComplete = missingCondition.length === 0;

  /**
   * Groups the shopper has been TOLD about. Separate from `missingCondition`
   * so nothing is marked red until they've actually pressed Continue — a form
   * that shouts before you've tried it is worse than one that stays quiet.
   */
  const [flagged, setFlagged] = useState<CondKey[]>([]);
  const groupRefs = useRef<Partial<Record<CondKey, HTMLDivElement | null>>>({});

  const goTo = (i: number, dir = 1) => {
    setCurrent(i);
    setMaxReached((m) => Math.max(m, i));
    // See wizard-scroll.ts — `scrollTo(0)` put the rail back on screen and
    // the next question below the fold on every mobile step.
    const stage = stageRef.current;
    if (stage) scrollTo(stage, { offset: wizardStageOffset() });
    if (!stage || reduced) return;
    registerGsap();
    const to = stage.querySelector(`[data-wz="${i}"]`);
    if (to) {
      gsap.fromTo(
        to.querySelectorAll('.wz-head, .dcard, .wz-form > *, .wz-done > *'),
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
    if (id !== 'other') setTimeout(() => goTo(1), reduced ? 0 : 220);
  };

  const toggleAccessory = (a: string) =>
    setCond((c) => {
      const list = c.accessories ?? [];
      return { ...c, accessories: list.includes(a) ? list.filter((x) => x !== a) : [...list, a] };
    });

  /** Answering a flagged group clears its marker straight away. */
  const answer = (key: CondKey, patch: Partial<SellCondition>) => {
    setCond((c) => ({ ...c, ...patch }));
    setFlagged((f) => f.filter((k) => k !== key));
  };

  /**
   * Continue from the condition step.
   *
   * This button used to carry `disabled={!conditionComplete}`, which is the
   * worst possible answer to a half-filled form: the shopper taps it, nothing
   * moves, and the page never says why or which question they skipped. Now it
   * is always pressable — pressing it with answers missing marks every one of
   * them, scrolls to the first, and puts focus on it.
   */
  const continueFromCondition = () => {
    if (conditionComplete) {
      setFlagged([]);
      goTo(2);
      return;
    }
    const keys = missingCondition.map((g) => g.key);
    setFlagged(keys);
    const first = keys[0] ? groupRefs.current[keys[0]] : null;
    if (first) {
      scrollTo(first, { offset: wizardStageOffset() });
      // After the scroll settles, so focus doesn't fight it for the viewport.
      window.setTimeout(() => first.querySelector('button')?.focus(), reduced ? 0 : 650);
    }
  };

  const slotsCls = (key: CondKey) =>
    flagged.includes(key) ? 'wz-slots wz-slots--missing' : 'wz-slots';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: SellRequestInput = {
      deviceId: device ?? '',
      deviceOther: device === 'other' ? deviceOther.trim() || undefined : undefined,
      condition: cond as SellCondition,
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      preferredContact: form.preferredContact,
      notes: form.notes.trim() || undefined,
    };
    const parsed = sellRequestInputSchema.safeParse(input);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[issue.path.length - 1]);
        if (!errs[key]) errs[key] = issue.message;
      }
      setErrors(errs);
      document.querySelector<HTMLElement>('.field--invalid input')?.focus();
      return;
    }
    setErrors({});
    createSell.mutate(parsed.data, {
      onSuccess: (req) => {
        setReference(req.reference);
        goTo(3);
      },
    });
  };

  const fieldCls = (name: string) => (errors[name] ? 'field field--invalid' : 'field');
  const railItems = [
    { label: 'Your phone', value: dev?.name ?? 'Pick a model' },
    { label: 'Condition', value: conditionComplete ? 'Assessed' : '—' },
    { label: 'Your details', value: form.name || '—' },
  ];

  return (
    <section className="wizard">
      <div className="wizard__grid container">
        {/* RAIL */}
        <aside className="wizard__rail" id="sellRail">
          <p className="eyebrow">
            <Spark variant="red" />
            Sell your device — about a minute
          </p>
          <h1 className="wizard__title" aria-label="Cash for your old phone.">
            <span className="h-mask">
              <span className="h-line">CASH FOR YOUR</span>
            </span>
            <span className="h-mask">
              <span className="h-line">
                <em>old phone.</em>
              </span>
            </span>
          </h1>

          <ol className="rail">
            {railItems.map((item, i) => {
              const done = i < current;
              const cls = ['rail__item', i === current && 'is-active', done && 'is-done']
                .filter(Boolean)
                .join(' ');
              return (
                <li
                  key={item.label}
                  className={cls}
                  data-cursor
                  onClick={() => {
                    if (i <= maxReached && current !== 3) goTo(i, i < current ? -1 : 1);
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

          <div className="rail__price">
            <span className="rail__price-cap">Our offer</span>
            <strong>We’ll quote you</strong>
            <em>confirmed after we inspect it</em>
          </div>

          <p className="rail__reassure">
            This is a guide only — we send a firm offer once we’ve checked the phone. Nothing is
            committed until you accept.
          </p>
        </aside>

        {/* STAGE */}
        <div className="wizard__stage" ref={stageRef}>
          {/* STEP 1 — device */}
          <section className={current === 0 ? 'wz-step is-active' : 'wz-step'} data-wz={0}>
            <header className="wz-head">
              <span className="wz-no">01 / 03</span>
              <h2>
                Which phone are we <em>buying?</em>
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
            {device === 'other' ? (
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

          {/* STEP 2 — condition */}
          <section className={current === 1 ? 'wz-step is-active' : 'wz-step'} data-wz={1}>
            <header className="wz-head">
              <button className="wz-back" onClick={() => goTo(0, -1)} data-cursor>
                ← Back
              </button>
              <span className="wz-no">02 / 03</span>
              <h2>
                What <em>condition</em> is it in?
              </h2>
              <p className="wz-hint">
                Honest answers get an honest quote. We check everything anyway.
              </p>
            </header>

            <div className="wz-form">
              <div
                className={slotsCls('storage')}
                ref={(el) => {
                  groupRefs.current.storage = el;
                }}
              >
                <span className="field__cap">Storage</span>
                <div className="slot-row">
                  {STORAGE.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={cond.storage === s ? 'slot is-active' : 'slot'}
                      onClick={() => answer('storage', { storage: s })}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <MissingNote show={flagged.includes('storage')} />
              </div>

              <div
                className={slotsCls('screen')}
                ref={(el) => {
                  groupRefs.current.screen = el;
                }}
              >
                <span className="field__cap">Screen condition</span>
                <div className="slot-row">
                  {SCREEN.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={cond.screen === o.id ? 'slot is-active' : 'slot'}
                      onClick={() => answer('screen', { screen: o.id })}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <MissingNote show={flagged.includes('screen')} />
              </div>

              <div
                className={slotsCls('body')}
                ref={(el) => {
                  groupRefs.current.body = el;
                }}
              >
                <span className="field__cap">Body condition</span>
                <div className="slot-row">
                  {BODY.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={cond.body === o.id ? 'slot is-active' : 'slot'}
                      onClick={() => answer('body', { body: o.id })}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <MissingNote show={flagged.includes('body')} />
              </div>

              <div className="wz-form__grid">
                <div
                  className={slotsCls('powersOn')}
                  ref={(el) => {
                    groupRefs.current.powersOn = el;
                  }}
                >
                  <span className="field__cap">Does it power on?</span>
                  <div className="slot-row">
                    {[
                      { v: true, l: 'Yes' },
                      { v: false, l: 'No' },
                    ].map((o) => (
                      <button
                        key={o.l}
                        type="button"
                        className={cond.powersOn === o.v ? 'slot is-active' : 'slot'}
                        onClick={() => answer('powersOn', { powersOn: o.v })}
                      >
                        {o.l}
                      </button>
                    ))}
                  </div>
                  <MissingNote show={flagged.includes('powersOn')} />
                </div>
                <div
                  className={slotsCls('network')}
                  ref={(el) => {
                    groupRefs.current.network = el;
                  }}
                >
                  <span className="field__cap">Network</span>
                  <div className="slot-row">
                    {(['unlocked', 'locked'] as NetworkStatus[]).map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={cond.network === n ? 'slot is-active' : 'slot'}
                        onClick={() => answer('network', { network: n })}
                      >
                        {n === 'unlocked' ? 'Unlocked' : 'Locked'}
                      </button>
                    ))}
                  </div>
                  <MissingNote show={flagged.includes('network')} />
                </div>
              </div>

              <div className="wz-slots">
                <span className="field__cap">Accessories included (optional)</span>
                <div className="slot-row">
                  {ACCESSORIES.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={(cond.accessories ?? []).includes(a) ? 'slot is-active' : 'slot'}
                      onClick={() => toggleAccessory(a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wz-form__foot">
                <div className="wz-form__price">
                  <span>Our offer</span>
                  <strong>We’ll quote you</strong>
                </div>
                <button
                  type="button"
                  className="btn btn--red btn--lg"
                  onClick={continueFromCondition}
                >
                  <span className="btn__label">Continue</span>
                  <span className="btn__arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </div>
              {/* The summary, for anyone whose skipped question scrolled out
                  of view. `role="alert"` so a screen reader hears it too —
                  the old disabled button announced nothing at all. */}
              {flagged.length > 0 ? (
                <p className="wz-form__missing" role="alert">
                  {flagged.length === 1
                    ? 'One answer still to go: '
                    : `${flagged.length} answers still to go: `}
                  {REQUIRED_CONDITION.filter((g) => flagged.includes(g.key))
                    .map((g) => g.label.replace(/\?$/, ''))
                    .join(', ')}
                  .
                </p>
              ) : null}
            </div>
          </section>

          {/* STEP 3 — contact */}
          <section className={current === 2 ? 'wz-step is-active' : 'wz-step'} data-wz={2}>
            <header className="wz-head">
              <button className="wz-back" onClick={() => goTo(1, -1)} data-cursor>
                ← Back
              </button>
              <span className="wz-no">03 / 03</span>
              <h2>
                Where do we <em>send the offer?</em>
              </h2>
              <p className="wz-hint">
                We’ll review your answers and send a firm quote. If you accept, a prepaid shipping
                label follows — post it in and we pay out on arrival.
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
              </div>
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
                <span>Anything else? (optional)</span>
                <textarea
                  rows={2}
                  placeholder="e.g. battery health 82%, screen replaced last year…"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              <div className="wz-form__foot">
                <div className="wz-form__price">
                  <span>Our offer</span>
                  <strong>We’ll quote you</strong>
                </div>
                <button
                  type="submit"
                  className="btn btn--red btn--lg"
                  ref={submitRef}
                  disabled={createSell.isPending}
                >
                  <span className="btn__label">
                    {createSell.isPending ? 'Sending…' : 'Get my offer'}
                  </span>
                  <span className="btn__arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </div>
              <p className="wz-form__legal">
                Submitting sends this to us for real, with a trackable reference. There’s no
                automatic pricing — a person reviews it and follows up with a firm quote.
              </p>
            </form>
          </section>

          {/* SUCCESS */}
          <section
            className={current === 3 ? 'wz-step wz-step--done is-active' : 'wz-step wz-step--done'}
            data-wz={3}
          >
            <div className="wz-done">
              <svg className="ck-tick" viewBox="0 0 96 96" aria-hidden="true">
                <circle className="ck-tick__ring" cx="48" cy="48" r="42" />
                <path className="ck-tick__check" d="M30 50 L43 63 L67 36" />
              </svg>
              <h2 className="wz-done__title">
                Offer on the way. <em>Nice one.</em>
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
                  <span>Condition</span>
                  <strong>
                    {cond.screen} screen · {cond.body} body
                  </strong>
                </div>
                <div className="done-row done-row--price">
                  <span>Our offer</span>
                  <strong>We’ll quote you</strong>
                </div>
              </div>
              <p className="wz-done__note">
                We’ll review it and send a firm quote to your{' '}
                {form.preferredContact === 'phone' ? 'phone' : 'email'}. Accept it and we’ll send a
                prepaid label — post it in and we pay out once it arrives and checks out.
              </p>
              <div className="wz-done__actions">
                <Link href="/track" className="btn btn--ink">
                  <span className="btn__label">Track my request</span>
                </Link>
                <Link href="/" className="btn btn--ghost">
                  <span className="btn__label">Back home</span>
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
