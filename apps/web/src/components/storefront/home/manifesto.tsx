'use client';

import { useEffect, useRef } from 'react';
import { gsap, registerGsap } from '@/lib/gsap';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { Reveal } from '@/components/storefront/reveal';

const MANIFESTO =
  'We’re not a kiosk with a heat gun. We’re the counter that treats a shattered phone like a Swiss watch — diagnosed honestly, rebuilt with parts you choose, tested until we’d carry it ourselves.';
const HL = ['Swiss', 'watch', 'honestly,', 'ourselves.'];

const GRADES = [
  {
    tier: 'Original',
    badge: '12-month warranty',
    strap: 'Pulled or service-pack parts from the manufacturer.',
    line: 'Identical to factory. True Tone, colours and brightness exactly as shipped.',
    price: 'e.g. iPhone 14 screen — ',
    priceStrong: '£161',
    featured: false,
  },
  {
    tier: 'OEM',
    badge: 'Most fitted · 6-month warranty',
    strap: 'Built in the same factories, sold without the logo.',
    line: 'Our most-fitted grade — 95% of the flagship experience at a fair price.',
    price: 'e.g. iPhone 14 screen — ',
    priceStrong: '£121',
    featured: true,
  },
  {
    tier: 'Copy',
    badge: '90-day warranty',
    strap: 'Quality-checked aftermarket. The honest budget option.',
    line: 'Great for older phones and resales. We’ll tell you straight when it isn’t.',
    price: 'e.g. iPhone 14 screen — ',
    priceStrong: '£83',
    featured: false,
  },
];

export function Manifesto() {
  const { reduced, ready } = useEnvironment();
  const textRef = useRef<HTMLParagraphElement>(null);
  const words = MANIFESTO.split(/\s+/);

  useEffect(() => {
    const el = textRef.current;
    if (!el || !ready || reduced) return;
    registerGsap();
    const tween = gsap.to(el.querySelectorAll('.w'), {
      opacity: 1,
      stagger: 0.6,
      ease: 'none',
      scrollTrigger: { trigger: el, start: 'top 80%', end: 'top 26%', scrub: true },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [ready, reduced]);

  return (
    <section className="manifesto" id="manifesto">
      <div className="container">
        <Reveal as="p" className="eyebrow">
          The Fonology promise
        </Reveal>
        <p className="manifesto__text" id="manifestoText" ref={textRef}>
          {words.map((w, i) => (
            <span key={i} className={`w${HL.includes(w) ? 'w--hl' : ''}`}>
              {w}
              {i < words.length - 1 ? ' ' : ''}
            </span>
          ))}
        </p>
      </div>

      <div className="grades container">
        <div className="grades__head">
          <Reveal as="h3" className="grades__title">
            Three part grades. <em>Zero</em> sales patter.
          </Reveal>
          <Reveal as="p" className="grades__strap">
            Every screen we fit comes in three honest grades. We’ll tell you straight which one your
            phone deserves — even when it’s the cheap one.
          </Reveal>
        </div>
        <div className="grades__row">
          {GRADES.map((g) => (
            <Reveal
              as="article"
              className={`grade${g.featured ? 'grade--featured' : ''}`}
              key={g.tier}
            >
              <header>
                <span className="grade__tier">{g.tier}</span>
                <span className="grade__badge">{g.badge}</span>
              </header>
              <p className="grade__strap">{g.strap}</p>
              <p className="grade__line">{g.line}</p>
              <span className="grade__price">
                {g.price}
                <strong>{g.priceStrong}</strong>
              </span>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
