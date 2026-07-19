'use client';

import { useEffect, useRef } from 'react';
import { gsap, registerGsap } from '@/lib/gsap';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { Reveal, LineMaskHeading } from '@/components/storefront/reveal';

const WHY = [
  {
    no: '01',
    title: 'Prices before screwdrivers',
    body: 'The price we quote is the price you pay. If we open it up and find something different, we call you before touching anything else.',
  },
  {
    no: '02',
    title: 'Parts you choose',
    body: 'Original, OEM or Copy — explained honestly, priced separately, warrantied in writing. You decide what your phone is worth.',
  },
  {
    no: '03',
    title: 'Fast, never rushed',
    body: 'Most repairs are done in under an hour while you get a coffee next door. Rushed work comes back — ours doesn’t.',
  },
  {
    no: '04',
    title: 'A face, not a form',
    body: 'One counter, real technicians, a phone number a human answers. Try getting that from a courier box and a call centre.',
  },
];

/** Animated count-up — port of core.js `[data-count]`. */
function Counter({
  value,
  decimals = 0,
  suffix = '',
}: {
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { reduced, ready } = useEnvironment();
  const fmt = (v: number) =>
    v.toLocaleString('en-GB', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }) + suffix;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!ready || reduced) {
      el.textContent = fmt(value);
      return;
    }
    registerGsap();
    const obj = { v: 0 };
    const tween = gsap.to(obj, {
      v: value,
      duration: 1.8,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      onUpdate: () => {
        el.textContent = fmt(decimals ? obj.v : Math.round(obj.v));
      },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, reduced, value, decimals, suffix]);

  return <span ref={ref}>0</span>;
}

export function WhyStats() {
  return (
    <section className="why" id="why">
      <div className="why__grid container">
        <div className="why__sticky">
          <Reveal as="p" className="eyebrow">
            Why Fonology
          </Reveal>
          <LineMaskHeading
            className="why__title"
            lines={['The shop the', <em key="e">whole city</em>, 'recommends.']}
          />
          <Reveal as="p" className="why__strap">
            …and the one other repair shops quietly bring their tricky boards to.
          </Reveal>
        </div>
        <ol className="why__list">
          {WHY.map((w) => (
            <Reveal as="li" className="why-item" key={w.no}>
              <span className="why-item__no">{w.no}</span>
              <div>
                <h3>{w.title}</h3>
                <p>{w.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>

      <div className="stats container" id="stats">
        <Reveal className="stat">
          <strong>
            <Counter value={12400} suffix="+" />
          </strong>
          <span className="stat__cap">repairs completed</span>
        </Reveal>
        <Reveal className="stat">
          <strong>
            <Counter value={38} />
            <em> min</em>
          </strong>
          <span className="stat__cap">average screen fix</span>
        </Reveal>
        <Reveal className="stat">
          <strong>
            <Counter value={4.9} decimals={1} />
            <em> ★</em>
          </strong>
          <span className="stat__cap">across 900+ reviews</span>
        </Reveal>
        <Reveal className="stat">
          <strong>
            <Counter value={90} />
            <em> day</em>
          </strong>
          <span className="stat__cap">minimum warranty</span>
        </Reveal>
      </div>
    </section>
  );
}
