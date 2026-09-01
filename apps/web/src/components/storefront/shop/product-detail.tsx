'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { Product, StorefrontVariant } from '@/lib/data/types';
import {
  formatGBP,
  canAddToCart,
  requiresVerification,
  stockLabel,
  hasVariants,
} from '@/lib/data/types';
import { useCartStore } from '@/lib/stores/cart.store';
import { toast } from '@/lib/stores/toast.store';
import { flyToCart } from '@/lib/fly-to-cart';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { useMagnetic } from '@/lib/hooks/use-magnetic';
import { ShieldCheck, Store } from 'lucide-react';
import { Spark, ProductArtGlyph } from '@/components/storefront/art';
import { BnplMessage } from '@/components/storefront/bnpl-message';
import { ProductCard } from '@/components/storefront/product-card';
import { PromiseStrip } from '@/components/storefront/promise-strip';
import { useCheckProductAvailability, useShopDetails } from '@/lib/data/hooks';
import { addressShort, addressPostcode, groupedHours } from '@/lib/data/types';
import { DELIVERY_OPTIONS } from '@/lib/config';
import { ImageLightbox } from './image-lightbox';
import { ProductReviews } from './product-reviews';

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
  const cartLines = useCartStore((s) => s.lines);
  const checkAvailability = useCheckProductAvailability();
  const { data: shop } = useShopDetails();
  const openHours = groupedHours(shop?.openingHours ?? []);
  const { reduced } = useEnvironment();
  const addRef = useMagnetic<HTMLButtonElement>();

  const [qty, setQty] = useState(1);
  const isVariantProduct = hasVariants(product);
  // Round 5 Phase 4 #16. Defaults to the first variant so a variant product
  // never lands on "nothing picked" — the picker below just shows which one
  // is currently active. `null` is only reached for a non-variant product,
  // where it's never read.
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    product.variants?.[0]?.id ?? null,
  );
  const selectedVariant: StorefrontVariant | null =
    product.variants?.find((v) => v.id === selectedVariantId) ?? null;
  const effectivePrice = product.price + (selectedVariant?.priceAdjustment ?? 0);
  const effectiveStockStatus = isVariantProduct
    ? (selectedVariant?.stockStatus ?? 'out-of-stock')
    : product.stockStatus;
  const [activeThumb, setActiveThumb] = useState(0);
  // Round 5 #18: was an in-place 1.6x scale (`zoomed` + `.is-zoomed`) —
  // replaced with a real fullscreen lightbox (image-lightbox.tsx). This
  // just tracks whether it's open; which image shows is still `activeThumb`,
  // shared with the thumbnail rail so opening/closing never loses your
  // place.
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [showSticky, setShowSticky] = useState(false);
  const buyRef = useRef<HTMLButtonElement>(null);

  const isVape = product.kind === 'vape';
  const isPlate = requiresVerification(product);
  // Round 5 Phase 4 #16: a variant product also needs a variant actually
  // selected and that variant in stock — canAddToCart alone only knows
  // about the parent's (frozen, meaningless) stockStatus.
  const canBuy =
    canAddToCart(product) &&
    (!isVariantProduct || (selectedVariantId != null && effectiveStockStatus === 'in-stock'));
  const notInStock = effectiveStockStatus !== 'in-stock';

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

  /**
   * Round 3 #4.1a: checked at the moment of adding, not left for checkout to
   * discover — against `existing bag quantity + qty`, not just `qty` alone,
   * since the bag might already hold some of this. Never shows a number
   * either way (customers never see stock counts) — just whether this many
   * fit.
   */
  const handleAdd = (fromEl: HTMLElement | null, onAdded?: () => void) => {
    if (!canBuy) return;
    const existingQty =
      cartLines.find(
        (l) => l.productId === product.id && (l.variantId ?? null) === selectedVariantId,
      )?.quantity ?? 0;
    checkAvailability.mutate(
      {
        productId: product.id,
        quantity: existingQty + qty,
        variantId: selectedVariant?.id,
      },
      {
        onSuccess: (available) => {
          if (!available) {
            toast(`Sorry — we don’t have that many ${product.name} in stock right now.`);
            return;
          }
          add(product, qty, selectedVariant ?? undefined);
          // Round 5 #28: the toaster only understands **markdown** bold, not
          // HTML — `<strong>` here rendered as literal visible tag text.
          toast(`**✓** ${product.name} added to your bag`);
          if (fromEl && !reduced) flyToCart(fromEl);
          onAdded?.();
        },
        onError: () => toast('Could not check stock — try again.'),
      },
    );
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
                className="pdp__stage"
                onClick={() => {
                  if (product.images.length > 0) setLightboxOpen(true);
                }}
                role={product.images.length > 0 ? 'button' : undefined}
                tabIndex={product.images.length > 0 ? 0 : undefined}
                aria-label={product.images.length > 0 ? 'View larger image' : undefined}
                onKeyDown={(e) => {
                  if (product.images.length > 0 && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    setLightboxOpen(true);
                  }
                }}
              >
                {/* Round 5 #17: moved to sit next to the title instead —
                    see .pdp__title-badge below. */}
                {product.images.length > 0 ? (
                  // `.pdp__stage` is position:relative, aspect-ratio 1/1
                  // (storefront-extend.css) — `fill` fits it exactly.
                  // `sizes` matches the gallery's actual layout: the
                  // sticky `.pdp__gallery` column is roughly half the page
                  // on desktop, full width once it stacks on mobile.
                  <Image
                    src={(product.images[activeThumb] ?? product.images[0]) as string}
                    alt={product.name}
                    fill
                    sizes="(max-width: 900px) 100vw, 50vw"
                    priority
                    className="pdp__photo"
                  />
                ) : (
                  <GalleryPlaceholder art={product.art} label />
                )}
              </div>
              {product.images.length > 1 ? (
                <div className="pdp__thumbs">
                  {product.images.map((url, i) => (
                    <button
                      key={url}
                      className={i === activeThumb ? 'pdp__thumb is-active' : 'pdp__thumb'}
                      onClick={() => setActiveThumb(i)}
                      aria-label={`View image ${i + 1}`}
                    >
                      {/* `.pdp__thumb` is aspect-ratio:1 with overflow
                          hidden — same fill pattern as the stage above. */}
                      <Image src={url} alt="" fill sizes="80px" className="pdp__thumb-photo" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* info */}
            <div className="pdp__info">
              <p className="pdp__eyebrow eyebrow">{categoryLabel}</p>
              {/* Round 5 #17: real column now (0054_product_badge_compat_
                  buyin.sql) — used to be hardcoded null server-side
                  regardless of what the admin form submitted, so this never
                  actually rendered for anyone. Next to the title, not
                  overlaid on the gallery — see .pdp__title-badge. */}
              {product.tag ? <span className="pdp__title-badge">{product.tag}</span> : null}
              <h1 className="pdp__title">{product.name}</h1>
              <p className="pdp__sub">{product.sub}</p>

              <div className="pdp__pricerow">
                <span className="pdp__price">{formatGBP(effectivePrice)}</span>
                <span className={notInStock ? 'pdp__stock is-out' : 'pdp__stock'}>
                  <i />
                  {isVape ? 'Available at the counter' : stockLabel(effectiveStockStatus)}
                </span>
              </div>

              {/* Buy-now-pay-later, sat against the price it qualifies rather
                  than down by the button: the number is what the customer is
                  weighing up, so this is the moment "or four instalments"
                  changes the answer. Not shown for the in-store-only path
                  (there is no online purchase to split) or when the item
                  cannot be bought. The amount is the real line total, qty
                  included, so the instalments quoted are the ones they would
                  actually be offered. Stripe decides whether it renders at
                  all — see BnplMessage. */}
              {!isVape && canBuy ? <BnplMessage amount={effectivePrice * qty} /> : null}

              {/* Round 5 Phase 4 #16: variant picker. Options are shown as a
                  flat map (colour/storage/whatever the admin named them) —
                  trimmed v1 has no separate per-axis pickers, one button per
                  variant is enough for the option counts this shop actually
                  has. */}
              {isVariantProduct ? (
                <div className="pdp__variants" role="group" aria-label="Choose an option">
                  {product.variants!.map((v) => {
                    const label = Object.values(v.options).join(', ');
                    const out = v.stockStatus === 'out-of-stock';
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className={
                          v.id === selectedVariantId ? 'pdp__variant is-active' : 'pdp__variant'
                        }
                        aria-pressed={v.id === selectedVariantId}
                        onClick={() => setSelectedVariantId(v.id)}
                      >
                        {label}
                        {out ? <span className="pdp__variant-out"> — out of stock</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

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
                  <ShieldCheck className="pdp__notice-icon" aria-hidden="true" />
                  <span>
                    <strong>ID documents required.</strong> Number plates are made to order and are
                    road-traffic regulated. At checkout you’ll upload your V5C/V750 (or an accepted
                    registration document) and your driving licence. Files are admin-access only and
                    deleted after {shop?.idDocumentRetentionDays ?? 30} days.
                  </span>
                </div>
              ) : null}

              {/* vape in-store-only block (no buy path) */}
              {isVape ? (
                <div className="pdp__notice pdp__notice--store">
                  <Store className="pdp__notice-icon" aria-hidden="true" />
                  <span>
                    <strong>Available in store only.</strong> We don’t sell vaping products online —
                    pop in to the counter and our team will sort you out. Over-18s only; ID may be
                    required.{' '}
                    <span className="pdp__store-meta">
                      {addressShort(shop?.shopAddress ?? null)},{' '}
                      {addressPostcode(shop?.shopAddress ?? null)}
                      {openHours[0] ? ` · ${openHours[0].days} ${openHours[0].time}` : ''}
                      {shop?.shopPhone ? ` · ${shop.shopPhone}` : ''}
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
                    disabled={!canBuy || checkAvailability.isPending}
                  >
                    <span className="btn__label">
                      {canBuy ? 'Add to bag' : stockLabel(effectiveStockStatus)}
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

          {/* details: description + compatibility + specs + delivery/returns */}
          <div className="pdp__details">
            <div className="pdp__block">
              <h2>Details</h2>
              {/* Round 5 #17: Description moved here from the buy column —
                  it used to sit right under the price/stock row, competing
                  with the actual buy decision for attention; the buy column
                  is now just the price, stock, notices and the Add button.
                  Descriptions authored in the admin are sanitised HTML
                  (bold, italics, lists); plain-text ones render identically
                  to before. Backend sanitises server-side too. */}
              {product.description ? (
                <div
                  className="pdp__desc"
                  dangerouslySetInnerHTML={{ __html: product.description }}
                />
              ) : null}
              {/* Round 5 #17: real column now — see the title badge's own
                  comment. Rendered as a list, split on commas, since a
                  compatibility note is often several devices ("iPhone 13,
                  iPhone 14, iPhone 15"), not always one range. */}
              {product.compatibility ? (
                <>
                  <p className="pdp__compat-label">Compatible with</p>
                  <ul className="pdp__compat-list">
                    {product.compatibility
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean)
                      .map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                  </ul>
                </>
              ) : null}
              {product.specs.length > 0 ? (
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
              ) : null}
            </div>
            <div className="pdp__block">
              <h2>Delivery &amp; returns</h2>
              <AccordionItem title="Delivery">
                {/*
                  Round 4 #BUG-06 follow-up: click & collect isn't offered at
                  checkout any more — no intro line advertising it, and the
                  section title dropped "& collection" to match. "from £x",
                  never a flat price. The real fee is postcode-derived and
                  quoted by the server at checkout (delivery_rates); stating a
                  fixed number here is a promise the basket may not keep. This
                  matches what checkout-flow.tsx already does.
                */}
                <p>UK delivery only:</p>
                <ul style={{ marginTop: 8 }}>
                  {/*
                    "from £x", never a flat price. The real fee is postcode-derived
                    and quoted by the server at checkout (delivery_rates); stating
                    a fixed number here is a promise the basket may not keep. This
                    matches what checkout-flow.tsx already does.
                  */}
                  {DELIVERY_OPTIONS.filter((o) => o.id !== 'collect').map((o) => (
                    <li key={o.id}>
                      {o.label} — from {formatGBP(o.price)} · {o.detail}
                      {o.id === 'next-day' && shop?.nextDayCutoffTime
                        ? ` (order before ${shop.nextDayCutoffTime.slice(0, 5)})`
                        : ''}
                    </li>
                  ))}
                </ul>
              </AccordionItem>
              <AccordionItem title="Returns">
                {/*
                  No `?? 30` here. This accordion and the PromiseStrip below are
                  on the same page, so a fallback number in either one is a page
                  that contradicts itself while the shop details load.
                */}
                {shop?.returnWindowDays != null ? (
                  <p>
                    {shop.returnWindowDays}-day no-quibble returns. Bring it back within{' '}
                    {shop.returnWindowDays} days for a refund or exchange — we’d rather have your
                    trust than your money.
                  </p>
                ) : (
                  <p>
                    No-quibble returns. Bring it back for a refund or exchange — we’d rather have
                    your trust than your money.
                  </p>
                )}
              </AccordionItem>
              {isPlate ? (
                <AccordionItem title="Made-to-order & verification">
                  <p>
                    Number plates are made to your registration after we verify your documents.
                    Uploads are admin-access only and deleted after{' '}
                    {shop?.idDocumentRetentionDays ?? 30} days.
                  </p>
                </AccordionItem>
              ) : null}
            </div>

            {/* Round 5 Phase 4 #21 — customer reviews, deliberately not the
                vape's own path (nothing here is buyable online for a vape). */}
            {!isVape ? <ProductReviews productId={product.id} productName={product.name} /> : null}
          </div>
        </div>

        {/* trust strip (reuses the shop promise block) */}
        <PromiseStrip returnWindowDays={shop?.returnWindowDays ?? null} />

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
            <div className="pdp__stickybar__price">{formatGBP(effectivePrice)}</div>
            <div className="text-muted text-xs">{product.name}</div>
          </div>
          <button
            className="btn btn--red"
            onClick={(e) => handleAdd(e.currentTarget, openCart)}
            disabled={!canBuy || checkAvailability.isPending}
          >
            <span className="btn__label">
              {canBuy ? 'Add to bag' : stockLabel(effectiveStockStatus)}
            </span>
          </button>
        </div>
      ) : null}

      {lightboxOpen && product.images.length > 0 ? (
        <ImageLightbox
          images={product.images}
          index={activeThumb}
          alt={product.name}
          onClose={() => setLightboxOpen(false)}
          onIndexChange={setActiveThumb}
        />
      ) : null}
    </>
  );
}
