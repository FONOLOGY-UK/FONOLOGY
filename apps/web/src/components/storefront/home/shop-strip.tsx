'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { gsap, registerGsap } from '@/lib/gsap';
import { useProducts } from '@/lib/data/hooks/use-products';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { Reveal, LineMaskHeading } from '@/components/storefront/reveal';
import { ProductCard } from '@/components/storefront/product-card';
import { Spark } from '@/components/storefront/art';

const FEATURED = ['aegis-15', 'volt-65', 'pulse-anc', 'arc-10k', 'glasspro-2', 'watch-duo'];

export function ShopStrip() {
  const { reduced, ready } = useEnvironment();
  const { data: products } = useProducts();
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const featured = FEATURED.map((id) => products?.find((p) => p.id === id)).filter(Boolean);

  useEffect(() => {
    if (!ready || reduced || !products) return;
    registerGsap();
    const track = trackRef.current;
    const wrap = wrapRef.current;
    if (!track || !wrap) return;

    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      const dist = () => track.scrollWidth - window.innerWidth + 60;
      const tween = gsap.to(track, {
        x: () => -dist(),
        ease: 'none',
        scrollTrigger: {
          trigger: wrap,
          start: 'top 68%',
          end: () => '+=' + dist(),
          scrub: 1,
          invalidateOnRefresh: true,
        },
      });
      return () => {
        tween.scrollTrigger?.kill();
        tween.kill();
        gsap.set(track, { x: 0 });
      };
    });
    return () => mm.revert();
  }, [ready, reduced, products]);

  return (
    <section className="shopstrip" id="shopstrip">
      <div className="shopstrip__head container">
        <div>
          <Reveal as="p" className="eyebrow">
            The counter shop
          </Reveal>
          <LineMaskHeading
            className="shopstrip__title"
            lines={[
              'Kit we’d put on',
              <>
                <em>our own</em> phones.
              </>,
            ]}
          />
        </div>
        <Link className="link-arrow" href="/shop" data-cursor>
          Browse everything<i>→</i>
        </Link>
      </div>
      <div className="shopstrip__wrap" id="shopWrap" ref={wrapRef}>
        <div className="shopstrip__track" id="shopTrack" ref={trackRef}>
          {featured.map((p) => (p ? <ProductCard key={p.id} product={p} /> : null))}
          <Link className="strip-cta" href="/shop" data-cursor-label="Shop">
            <Spark variant="red" style={{ width: 22, height: 22 }} />
            <strong>
              The full <em>shelf</em> is bigger.
            </strong>
            <span>Cases, power, audio, protection — all bench-tested. →</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
