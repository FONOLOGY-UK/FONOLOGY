'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMagnetic } from '@/lib/hooks/use-magnetic';
import { CONTACT } from '@/lib/site';
import { LineMaskHeading, Reveal } from '@/components/storefront/reveal';

/**
 * Shared red CTA band (from the prototype). Parameterised so the home and shop
 * pages can supply their own copy while keeping identical visual treatment.
 */
export function CtaBand({
  lines,
  sub,
  buttonLabel,
  buttonHref = '/repair',
  showTel = false,
}: {
  lines: ReactNode[];
  sub: string;
  buttonLabel: string;
  buttonHref?: string;
  showTel?: boolean;
}) {
  const bookRef = useMagnetic<HTMLAnchorElement>();
  return (
    <section className="ctaband" id="ctaband">
      <div className="ctaband__inner container">
        <LineMaskHeading className="ctaband__title" lines={lines} />
        <Reveal as="p" className="ctaband__sub">
          {sub}
        </Reveal>
        <Reveal className="ctaband__actions">
          <Link href={buttonHref} className="btn btn--white btn--lg" ref={bookRef}>
            <span className="btn__label">{buttonLabel}</span>
            <span className="btn__arrow" aria-hidden="true">
              →
            </span>
          </Link>
          {showTel ? (
            <a href={CONTACT.phoneHref} className="ctaband__tel" data-cursor>
              or call {CONTACT.phone}
            </a>
          ) : null}
        </Reveal>
      </div>
    </section>
  );
}
