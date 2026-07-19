'use client';

import Link from 'next/link';
import { useRef } from 'react';
import type { Product } from '@/lib/data/types';
import { formatGBP } from '@/lib/data/types';
import { useCartStore } from '@/lib/stores/cart.store';
import { toast } from '@/lib/stores/toast.store';
import { flyToCart } from '@/lib/fly-to-cart';
import { useEnvironment } from '@/lib/hooks/use-environment';
import { ProductArtGlyph } from './art';

/**
 * Product card — reproduces the prototype's `productCardHTML` exactly. The tile
 * art and name link to the PDP (new in Phase 2); the add-to-bag button keeps
 * the prototype's behaviour (add + toast + fly-to-cart).
 */
export function ProductCard({ product, wide }: { product: Product; wide?: boolean }) {
  const add = useCartStore((s) => s.add);
  const { reduced } = useEnvironment();
  const btnRef = useRef<HTMLButtonElement>(null);

  const href = `/shop/${product.slug}`;

  const onAdd = () => {
    if (!product.inStock) return;
    add(product);
    toast(`<strong>✓</strong>&nbsp; ${product.name} added to your bag`);
    if (btnRef.current && !reduced) flyToCart(btnRef.current);
  };

  return (
    <article className={`pcard${wide ? 'pcard--wide' : ''}`} data-id={product.id}>
      <div className={`pcard__tile pcard__tile--${product.tile}`}>
        {product.tag ? <span className="pcard__tag">{product.tag}</span> : null}
        {!product.inStock ? <span className="pcard__oos">Out of stock</span> : null}
        {/* Invisible full-tile link to the PDP, sitting below the add button. */}
        <Link
          href={href}
          className="pcard__link"
          aria-label={`View ${product.name}`}
          style={{ position: 'absolute', inset: 0, zIndex: 1 }}
        />
        <ProductArtGlyph art={product.art} className="pcard__art" />
        <button
          className="pcard__add"
          ref={btnRef}
          onClick={onAdd}
          disabled={!product.inStock}
          data-cursor
        >
          {product.inStock ? <>Add to bag&nbsp; +</> : 'Out of stock'}
        </button>
      </div>
      <div className="pcard__meta">
        <h3>
          <Link href={href}>{product.name}</Link>
        </h3>
        <span className="pcard__price">{formatGBP(product.price)}</span>
        <span className="pcard__sub">{product.sub}</span>
        <span className={`pcard__stock${product.inStock ? '' : 'is-out'}`}>
          <i />
          {product.inStock ? 'In stock' : 'Restocking'}
        </span>
      </div>
    </article>
  );
}
