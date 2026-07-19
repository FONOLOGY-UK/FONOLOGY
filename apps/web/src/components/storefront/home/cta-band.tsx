'use client';

import Link from 'next/link';
import { useMagnetic } from '@/lib/hooks/use-magnetic';
import { CONTACT } from '@/lib/site';
import { LineMaskHeading, Reveal } from '@/components/storefront/reveal';

export function CtaBand() {
  const bookRef = useMagnetic<HTMLAnchorElement>();
  return (
    <section className="ctaband" id="ctaband">
      <div className="ctaband__inner container">
        <LineMaskHeading
          className="ctaband__title"
          lines={['In by 4pm.', <em key="e">Out the same day.</em>]}
        />
        <Reveal as="p" className="ctaband__sub">
          Book a slot, walk in, walk out fixed. Or just turn up — the kettle’s on.
        </Reveal>
        <Reveal className="ctaband__actions">
          <Link href="/repair" className="btn btn--white btn--lg" ref={bookRef}>
            <span className="btn__label">Start a repair</span>
            <span className="btn__arrow" aria-hidden="true">
              →
            </span>
          </Link>
          <a href={CONTACT.phoneHref} className="ctaband__tel" data-cursor>
            or call {CONTACT.phone}
          </a>
        </Reveal>
      </div>
    </section>
  );
}
