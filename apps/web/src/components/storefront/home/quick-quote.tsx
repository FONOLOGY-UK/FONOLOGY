'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EASE, gsap, registerGsap } from '@/lib/gsap';
import { formatGBP } from '@/lib/data/types';
import { useDevices, useRepairOffers, useRepairTypes } from '@/lib/data/hooks/use-repair';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { useMagnetic } from '@/lib/hooks/use-magnetic';
import { Reveal, LineMaskHeading } from '@/components/storefront/reveal';

// How many chips each row shows. The chips are the shop's real catalogue (ids are
// UUIDs from the API) — they were once hardcoded design-mock slugs ('ip15p', 's24'),
// which matched nothing, so the price never showed and the hand-off to /repair
// carried an id the wizard ignored.
const QB_MAX_DEVICES = 6;
const QB_MAX_REPAIRS = 3;

export function QuickQuote() {
  const { reduced, ready } = useEnvironment();
  const { data: devices } = useDevices();
  const { data: repairs } = useRepairTypes();
  const ctaRef = useMagnetic<HTMLAnchorElement>();

  // "Other / not listed" has no price to quote, and a diagnosis has no "from" price.
  const qbDevices = (devices ?? [])
    .filter((d) => !/^other\b/i.test(d.name))
    .slice(0, QB_MAX_DEVICES);

  const [picked, setDevice] = useState<string | null>(null);
  const [pickedRepair, setRepair] = useState<string | null>(null);
  const device = picked ?? qbDevices[0]?.id ?? null;

  // The device's own prices (0109): only repairs it offers are shown, and the
  // "from" price is its cheapest grade of the one picked.
  const { data: offers } = useRepairOffers(device);
  const cheapest = (repairId: string) => {
    const prices = (offers ?? []).filter((o) => o.repairId === repairId).map((o) => o.price);
    return prices.length ? Math.min(...prices) : null;
  };
  const qbRepairs = (repairs ?? [])
    .filter((r) => !r.diagnosisOnly && cheapest(r.id) !== null)
    .slice(0, QB_MAX_REPAIRS);
  const repair =
    (pickedRepair && qbRepairs.some((r) => r.id === pickedRepair) ? pickedRepair : null) ??
    qbRepairs[0]?.id ??
    null;

  const priceRef = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const first = useRef(true);

  const dev = qbDevices.find((d) => d.id === device);
  const rep = qbRepairs.find((r) => r.id === repair);
  const from = dev && rep ? cheapest(rep.id) : null;

  // Ambient spin on the giant spark.
  const sparkRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ready || reduced || !sparkRef.current) return;
    registerGsap();
    const svg = sparkRef.current.querySelector('svg');
    const tween = gsap.to(svg, { rotate: 360, duration: 60, repeat: -1, ease: 'none' });
    return () => {
      tween.kill();
    };
  }, [ready, reduced]);

  // Animate the price when it changes.
  useEffect(() => {
    const el = priceRef.current;
    if (!el || from == null) return;
    if (first.current || reduced) {
      shown.current = from;
      el.textContent = formatGBP(from);
      first.current = false;
      return;
    }
    const obj = { v: shown.current };
    gsap.to(obj, {
      v: from,
      duration: 0.7,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = formatGBP(Math.round(obj.v / 100) * 100);
      },
      onComplete: () => {
        shown.current = from;
      },
    });
    gsap.fromTo(
      el,
      { y: 14, autoAlpha: 0.4 },
      { y: 0, autoAlpha: 1, duration: 0.5, ease: EASE.out },
    );
  }, [from, reduced]);

  const note =
    dev && rep ? `${dev.name} · ${rep.name.toLowerCase()} · fitted same-day, warrantied` : '';

  return (
    <section className="quickbook" id="quickbook">
      <div className="quickbook__spark" aria-hidden="true" ref={sparkRef}>
        <svg viewBox="0 0 24 24">
          <path d="M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5 Z" />
        </svg>
      </div>
      <div className="container">
        <Reveal as="p" className="eyebrow eyebrow--onred">
          Instant quote — no email required
        </Reveal>
        <LineMaskHeading
          className="quickbook__title"
          lines={['Price it in', <em key="e">ten seconds.</em>]}
        />

        <div className="qb">
          <div className="qb__col">
            <span className="qb__label">01 — Your phone</span>
            <div className="qb__chips">
              {qbDevices.map((d) => (
                <button
                  key={d.id}
                  className={device === d.id ? 'chip is-active' : 'chip'}
                  onClick={() => setDevice(d.id)}
                >
                  {d.name}
                </button>
              ))}
            </div>
            <span className="qb__label qb__label--gap">02 — The problem</span>
            <div className="qb__chips">
              {qbRepairs.map((r) => (
                <button
                  key={r.id}
                  className={repair === r.id ? 'chip is-active' : 'chip'}
                  onClick={() => setRepair(r.id)}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
          <div className="qb__result">
            <span className="qb__from">from</span>
            <div className="qb__price">
              <span ref={priceRef}>{from != null ? formatGBP(from) : '£—'}</span>
            </div>
            <p className="qb__note">{note}</p>
            <Link
              className="btn btn--red"
              href={
                device && repair
                  ? `/repair?device=${encodeURIComponent(device)}&repair=${encodeURIComponent(repair)}`
                  : '/repair'
              }
              ref={ctaRef}
            >
              <span className="btn__label">Start my repair</span>
              <span className="btn__arrow" aria-hidden="true">
                →
              </span>
            </Link>
            <p className="qb__small">
              Full booking takes about a minute. Pay nothing until it’s fixed.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
