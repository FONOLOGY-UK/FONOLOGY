'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useProducts } from '@/lib/data/hooks/use-products';
import { isPurchasable } from '@/lib/data/types';
import { Reveal, LineMaskHeading } from '@/components/storefront/reveal';
import { ProductCard } from '@/components/storefront/product-card';

/**
 * Featured shop strip — a standard paged product grid (4 × 2 per page) with
 * arrow controls, like any high-street store's "see more" carousel.
 *
 * NOTE: the prototype scrubbed this strip horizontally as the page scrolled
 * vertically. That scroll-jacking was REMOVED on request — the strip never
 * moves on its own. Horizontal movement happens only when the shopper drags/
 * scrolls the row themselves or presses an arrow (native overflow scrolling
 * with scroll-snap, so both work together).
 */

const PER_PAGE = 8;

export function ShopStrip() {
  const { data: products } = useProducts();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);

  // Everything sellable online, in catalogue order (vapes are in-store only).
  const featured = (products ?? []).filter(isPurchasable);
  const pages: (typeof featured)[] = [];
  for (let i = 0; i < featured.length; i += PER_PAGE) {
    pages.push(featured.slice(i, i + PER_PAGE));
  }
  const pageCount = Math.max(1, pages.length);

  // Keep the indicator honest when the shopper scrolls/drags the row by hand.
  const syncPage = useCallback(() => {
    const el = viewportRef.current;
    if (!el || el.clientWidth === 0) return;
    setPage(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener('scroll', syncPage, { passive: true });
    return () => el.removeEventListener('scroll', syncPage);
  }, [syncPage]);

  const goTo = (next: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(pageCount - 1, next));
    el.scrollTo({ left: target * el.clientWidth, behavior: 'smooth' });
    setPage(target);
  };

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
              <Fragment key="l2">
                <em>our own</em> phones.
              </Fragment>,
            ]}
          />
        </div>
        <Link className="link-arrow" href="/shop" data-cursor>
          Browse everything<i>→</i>
        </Link>
      </div>

      <div className="stripgrid container">
        <div className="stripgrid__viewport" ref={viewportRef}>
          <div className="stripgrid__track">
            {pages.map((chunk, i) => (
              <div className="stripgrid__page" key={i}>
                {chunk.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            ))}
          </div>
        </div>

        {pageCount > 1 ? (
          <div className="stripgrid__nav" style={{ marginTop: 24 }}>
            <button
              className="stripgrid__arrow"
              onClick={() => goTo(page - 1)}
              disabled={page === 0}
              aria-label="Previous products"
            >
              ←
            </button>
            <button
              className="stripgrid__arrow"
              onClick={() => goTo(page + 1)}
              disabled={page >= pageCount - 1}
              aria-label="More products"
            >
              →
            </button>
            <span className="stripgrid__count" aria-live="polite">
              {page + 1} / {pageCount}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
