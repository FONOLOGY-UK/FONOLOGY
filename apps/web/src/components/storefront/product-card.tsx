'use client';

import Link from 'next/link';
import { useRef } from 'react';
import type { Product } from '@/lib/data/types';
import { formatGBP, canAddToCart, stockLabel } from '@/lib/data/types';
import { useCartStore } from '@/lib/stores/cart.store';
import { useCheckProductAvailability } from '@/lib/data/hooks';
import { toast } from '@/lib/stores/toast.store';
import { flyToCart } from '@/lib/fly-to-cart';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { ProductArtGlyph } from './art';

/**
 * Product card — reproduces the prototype's `productCardHTML`. The tile art and
 * name link to the PDP (Phase 2). Add-to-bag keeps the prototype behaviour.
 * Vapes are display-only ("In store only", no add — 6.2); out-of-stock and
 * restocking states disable purchase.
 */
export function ProductCard({ product, wide }: { product: Product; wide?: boolean }) {
  const add = useCartStore((s) => s.add);
  const cartLines = useCartStore((s) => s.lines);
  const checkAvailability = useCheckProductAvailability();
  const { reduced } = useEnvironment();
  const btnRef = useRef<HTMLButtonElement>(null);

  const href = `/shop/${product.slug}`;
  const isVape = product.kind === 'vape';
  const canAdd = canAddToCart(product);
  const notInStock = product.stockStatus !== 'in-stock';

  const articleClass = ['pcard', wide && 'pcard--wide', isVape && 'pcard--vape']
    .filter(Boolean)
    .join(' ');

  // Round 3 #4.1a: the card only ever adds one unit, but a repeated click
  // (nothing here re-reads stockStatus between clicks) could still stack
  // past what's in stock — checked against the bag's EXISTING quantity for
  // this product, not just "1" in isolation.
  const onAdd = () => {
    if (!canAdd) return;
    const existingQty = cartLines.find((l) => l.productId === product.id)?.quantity ?? 0;
    checkAvailability.mutate(
      { productId: product.id, quantity: existingQty + 1 },
      {
        onSuccess: (available) => {
          if (!available) {
            toast(`Sorry — we don’t have any more ${product.name} in stock right now.`);
            return;
          }
          add(product);
          // Round 5 #28: the toaster only understands **markdown** bold, not
          // HTML — `<strong>` here rendered as literal visible tag text.
          toast(`**✓** ${product.name} added to your bag`);
          if (btnRef.current && !reduced) flyToCart(btnRef.current);
        },
        onError: () => toast('Could not check stock — try again.'),
      },
    );
  };

  return (
    <article className={articleClass} data-id={product.id}>
      <div className={`pcard__tile pcard__tile--${product.tile}`}>
        {product.tag ? <span className="pcard__tag">{product.tag}</span> : null}
        {isVape ? (
          <span className="pcard__oos pcard__flag--store">In store only</span>
        ) : notInStock ? (
          <span className="pcard__oos">{stockLabel(product.stockStatus)}</span>
        ) : null}
        {/* Invisible full-tile link to the PDP, sitting below the add button. */}
        <Link
          href={href}
          className="pcard__link"
          aria-label={`View ${product.name}`}
          style={{ position: 'absolute', inset: 0, zIndex: 1 }}
        />
        {product.images.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element -- real, arbitrary Supabase Storage URLs
          <img src={product.images[0]} alt="" className="pcard__photo" />
        ) : (
          <ProductArtGlyph art={product.art} className="pcard__art" />
        )}
        {isVape ? (
          <Link href={href} className="pcard__add" data-cursor>
            In store only&nbsp; →
          </Link>
        ) : (
          <button
            className="pcard__add"
            ref={btnRef}
            onClick={onAdd}
            disabled={!canAdd || checkAvailability.isPending}
            data-cursor
          >
            {canAdd ? <>Add to bag&nbsp; +</> : stockLabel(product.stockStatus)}
          </button>
        )}
      </div>
      <div className="pcard__meta">
        <h3>
          <Link href={href}>{product.name}</Link>
        </h3>
        <span className="pcard__price">{formatGBP(product.price)}</span>
        <span className="pcard__sub">{product.sub}</span>
        <span className={notInStock ? 'pcard__stock is-out' : 'pcard__stock'}>
          <i />
          {isVape ? 'At the counter' : stockLabel(product.stockStatus)}
        </span>
      </div>
    </article>
  );
}
