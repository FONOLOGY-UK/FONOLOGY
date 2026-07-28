'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Product } from '@/lib/data/types';
import { formatGBP, canAddToCart, requiresVerification, stockLabel } from '@/lib/data/types';
import { useCartStore } from '@/lib/stores/cart.store';
import { toast } from '@/lib/stores/toast.store';
import { flyToCart } from '@/lib/fly-to-cart';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { useMagnetic } from '@/lib/hooks/use-magnetic';
import { Spark, ProductArtGlyph } from '@/components/storefront/art';
import { ProductCard } from '@/components/storefront/product-card';
import { PromiseStrip } from '@/components/storefront/promise-strip';
import { CONTACT, HOURS } from '@/lib/site';
import { DELIVERY_OPTIONS, RETURN_WINDOW_DAYS } from '@/lib/config';

/** Grey image placeholder (real photography swaps in later — 6.2). */
function GalleryPlaceholder({ art, label }: { art: Product['art']; label?: boolean }) {
  return (
    <div className="pdp__ph">
      <ProductArtGlyph art={art} />
      {label ? <span className="mt-3 block">Image coming soon</span> : null}
    </div>
  );
}

/** One collapsible accordion row (delivery / returns). Uses the CSS grid-rows
 *  open/close technique — no JS height measurement. */
function AccordionItem({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? 'acc__item is-open' : 'acc__item'}>
      <button className="acc__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {title}
        <span className="acc__icon" aria-hidden="true">
          +
        </span>
      </button>
      <div className="acc__panel">
        <div className="acc__inner">{children}</div>
      </div>
    </div>
  );
}

export function ProductDetail({
  product,
  categoryLabel,
  related,
}: {
  product: Product;
  categoryLabel: string;
  related: Product[];
}) {
  const add = useCartStore((s) => s.add);
  const openCart = useCartStore((s) => s.open);
  const { reduced } = useEnvironment();
  const addRef = useMagnetic<HTMLButtonElement>();

  const [qty, setQty] = useState(1);
  const [activeThumb, setActiveThumb] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [showSticky, setShowSticky] = useState(false);
  const buyRef = useRef<HTMLButtonElement>(null);

  const isVape = product.kind === 'vape';
  const isPlate = requiresVerification(product);
  const canBuy = canAddToCart(product);
  const notInStock = product.stockStatus !== 'in-stock';

  // Reveal the sticky mobile bar once the main buy button scrolls out of view.
  useEffect(() => {
    if (isVape) return;
    const el = buyRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setShowSticky(!entry.isIntersecting);
      },
      { rootMargin: '-80px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isVape]);

  const handleAdd = (fromEl: HTMLElement | null) => {
    if (!canBuy) return;
    add(product, qty);
    toast(`<strong>✓</strong>&nbsp; ${product.name} added to your bag`);
    if (fromEl && !reduced) flyToCart(fromEl);
  };

  return (
    <>
      <section className="pdp">
        <div className="container">
          {/* breadcrumbs */}
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span className="crumbs__sep" aria-hidden="true">
              /
            </span>
            <Link href="/shop">Shop</Link>
            <span className="crumbs__sep" aria-hidden="true">
              /
            </span>
            <Link href={`/shop?category=${product.category}`}>{categoryLabel}</Link>
            <span className="crumbs__sep" aria-hidden="true">
              /
            </span>
            <span className="crumbs__here">{product.name}</span>
          </nav>

          <div className="pdp__grid">
            {/* gallery — grey placeholders */}
            <div className="pdp__gallery">
              <div
                className={zoomed ? 'pdp__stage is-zoomed' : 'pdp__stage'}
                onClick={() => setZoomed((v) => !v)}
                role="button"
                tabIndex={0}
                aria-label="Product image (placeholder)"
              >
                {product.tag ? <span className="pdp__badge">{product.tag}</span> : null}
                <GalleryPlaceholder art={product.art} label />
              </div>
              <div className="pdp__thumbs">
                {[0, 1, 2, 3].map((i) => (
                  <button
                    key={i}
                    className={i === activeThumb ? 'pdp__thumb is-active' : 'pdp__thumb'}
                    onClick={() => setActiveThumb(i)}
                    aria-label={`View image ${i + 1}`}
                  >
                    <ProductArtGlyph art={product.art} />
                  </button>
                ))}
              </div>
            </div>

            {/* info */}
            <div className="pdp__info">
              <p className="pdp__eyebrow eyebrow">
                <Spark variant="red" />
                {categoryLabel}
              </p>
              <h1 className="pdp__title">{product.name}</h1>
              <p className="pdp__sub">{product.sub}</p>

              <div className="pdp__pricerow">
                <span className="pdp__price">{formatGBP(product.price)}</span>
                <span className={notInStock ? 'pdp__stock is-out' : 'pdp__stock'}>
                  <i />
                  {isVape ? 'Available at the counter' : stockLabel(product.stockStatus)}
                </span>
              </div>

              {product.compatibility ? (
                <p className="pdp__sub">Compatible with {product.compatibility}</p>
              ) : null}

              {/* Descriptions authored in the admin are sanitised HTML (bold,
                  italics, lists). Plain-text descriptions render identically
                  to before. Backend must sanitise server-side too. */}
              <div
                className="pdp__desc"
                dangerouslySetInnerHTML={{ __html: product.description }}
              />

              <ul className="pdp__highlights">
                {product.highlights.map((h) => (
                  <li key={h}>
                    <Spark variant="red" />
                    {h}
                  </li>
                ))}
              </ul>

              {/* plate ID-verification notice */}
              {isPlate ? (
                <div className="pdp__notice pdp__notice--id">
                  <Spark variant="red" />
                  <span>
                    <strong>ID documents required.</strong> Number plates are made to order and are
                    road-traffic regulated. At checkout you’ll upload your V5C/V750 (or an accepted
                    registration document) and your driving licence. Files are admin-access only and
                    deleted after 30 days.
                  </span>
                </div>
              ) : null}

              {/* vape in-store-only block (no buy path) */}
              {isVape ? (
                <div className="pdp__notice pdp__notice--store">
                  <Spark variant="red" />
                  <span>
                    <strong>Available in store only.</strong> We don’t sell vaping products online —
                    pop in to the counter and our team will sort you out. Over-18s only; ID may be
                    required.{' '}
                    <span className="pdp__store-meta">
                      {CONTACT.addressShort}, {CONTACT.postcode} · {HOURS[0].day} {HOURS[0].time} ·{' '}
                      {CONTACT.phone}
                    </span>
                  </span>
                </div>
              ) : (
                <div className="pdp__buy">
                  <div className="qty" aria-label="Quantity">
                    <button
                      className="qty__btn"
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      disabled={!canBuy || qty <= 1}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="qty__num">{qty}</span>
                    <button
                      className="qty__btn"
                      onClick={() => setQty((q) => Math.min(10, q + 1))}
                      disabled={!canBuy || qty >= 10}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="btn btn--red btn--lg"
                    ref={(node) => {
                      buyRef.current = node;
                      addRef.current = node;
                    }}
                    onClick={() => handleAdd(buyRef.current)}
                    disabled={!canBuy}
                  >
                    <span className="btn__label">
                      {canBuy ? 'Add to bag' : stockLabel(product.stockStatus)}
                    </span>
                    {canBuy ? (
                      <span className="btn__arrow" aria-hidden="true">
                        →
                      </span>
                    ) : null}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* details: specs + delivery/returns */}
          <div className="pdp__details">
            <div className="pdp__block">
              <h2>Details</h2>
              <table className="spec-table">
                <tbody>
                  {product.specs.map((s) => (
                    <tr key={s.label}>
                      <th scope="row">{s.label}</th>
                      <td>{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pdp__block">
              <h2>Delivery &amp; returns</h2>
              <AccordionItem title="Delivery & collection">
                <p>Free click &amp; collect from the counter. UK delivery only:</p>
                <ul style={{ marginTop: 8 }}>
                  {DELIVERY_OPTIONS.filter((o) => o.id !== 'collect').map((o) => (
                    <li key={o.id}>
                      {o.label} — {formatGBP(o.price)} · {o.detail}
                    </li>
                  ))}
                </ul>
              </AccordionItem>
              <AccordionItem title="Returns">
                <p>
                  {RETURN_WINDOW_DAYS}-day no-quibble returns. Bring it back within{' '}
                  {RETURN_WINDOW_DAYS} days for a refund or exchange — we’d rather have your trust
                  than your money.
                </p>
              </AccordionItem>
              {isPlate ? (
                <AccordionItem title="Made-to-order & verification">
                  <p>
                    Number plates are made to your registration after we verify your documents.
                    Uploads are admin-access only and deleted after 30 days.
                  </p>
                </AccordionItem>
              ) : null}
            </div>
          </div>
        </div>

        {/* trust strip (reuses the shop promise block) */}
        <PromiseStrip />

        {/* related */}
        {related.length > 0 ? (
          <div className="pdp__related container">
            <div className="pdp__related-head">
              <h2 className="pdp__related-title">More in {categoryLabel}</h2>
              <Link className="link-arrow" href={`/shop?category=${product.category}`} data-cursor>
                See all<i>→</i>
              </Link>
            </div>
            <div className="pdp__related-row">
              {related.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* sticky mobile add-to-cart bar */}
      {!isVape ? (
        <div className={showSticky ? 'pdp__stickybar is-on' : 'pdp__stickybar'}>
          <div>
            <div className="pdp__stickybar__price">{formatGBP(product.price)}</div>
            <div className="text-muted text-xs">{product.name}</div>
          </div>
          <button
            className="btn btn--red"
            onClick={(e) => {
              handleAdd(e.currentTarget);
              openCart();
            }}
            disabled={!canBuy}
          >
            <span className="btn__label">
              {canBuy ? 'Add to bag' : stockLabel(product.stockStatus)}
            </span>
          </button>
        </div>
      ) : null}
    </>
  );
}
