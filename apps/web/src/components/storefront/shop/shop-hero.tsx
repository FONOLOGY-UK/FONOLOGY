'use client';

import { Marquee } from '@/components/storefront/marquee';
import { LineMaskHeading } from '@/components/storefront/reveal';
import { Spark } from '@/components/storefront/art';

const MARQUEE_ITEMS = [
  'Free click & collect',
  'Fitted free at the counter',
  '30-day returns',
  'Tested by technicians',
];

export function ShopHero() {
  return (
    <section className="shophero">
      <div className="container">
        <p className="shophero__eyebrow eyebrow">
          <Spark variant="red" />
          The counter shop — tested at the bench
        </p>
        <LineMaskHeading
          as="h1"
          className="shophero__title"
          immediate
          lines={['GOOD KIT', <em key="e">only.</em>]}
        />
        <p className="shophero__sub">
          Every case, cable and charger here earned its shelf space at our repair bench. If it
          breaks phones — or breaks itself — we don’t stock it.
        </p>
      </div>
      <Marquee items={MARQUEE_ITEMS} speed={60} variant="ink" className="shophero__marquee" />
    </section>
  );
}
