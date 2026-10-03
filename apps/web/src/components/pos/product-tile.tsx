'use client';

import { memo } from 'react';
import { Star } from 'lucide-react';
import type { AdminProduct } from '@/lib/data/types';
import { formatGBP, productIsLowStock } from '@/lib/data/types';
import { cn } from '@/lib/utils';

/**
 * One product tile on the till. A component of its own — and memoised — because the catalogue is
 * hundreds of tiles and the till re-renders on every keystroke and every ticket change: with the
 * tiles inline, each of those redrew all of them. The handlers must be referentially stable for
 * the memo to hold (PosView passes ones that read the latest state through a ref).
 */
export const ProductTile = memo(function ProductTile({
  product,
  pinned,
  highlighted,
  onOpen,
  onTogglePin,
}: {
  product: AdminProduct;
  pinned: boolean;
  /** The keyboard-selected tile while a search is typed. */
  highlighted: boolean;
  onOpen: (product: AdminProduct) => void;
  onTogglePin: (productId: string, pinned: boolean) => void;
}) {
  // Round 5 Phase 4 #16: a has_variants product's own stockQty is frozen and meaningless (0060) —
  // never grey the tile out on it. Whether it's actually sellable is a per-variant question,
  // answered once the picker is open.
  const out = product.hasVariants ? false : product.stockQty <= 0;

  return (
    <div
      role="button"
      tabIndex={out ? -1 : 0}
      onClick={() => onOpen(product)}
      onKeyDown={(e) => {
        if (!out && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen(product);
        }
      }}
      aria-disabled={out}
      className={cn(
        'border-line bg-card relative rounded-lg border p-3 text-left transition-colors duration-150',
        out
          ? 'cursor-not-allowed opacity-45'
          : 'hover:border-red active:bg-red-tint/60 cursor-pointer',
        highlighted && !out && 'border-red ring-red ring-1',
      )}
    >
      {/* Round 5 Phase 2 #3 — pin/unpin, own favourites only. Nested inside the tile's own click
          target, so it needs its own stopPropagation to avoid also adding the product to the ticket. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(product.id, pinned);
        }}
        className={cn(
          'absolute right-1.5 top-1.5 rounded-full p-1 transition-colors',
          pinned ? 'text-red' : 'text-muted/50 hover:text-muted',
        )}
        aria-label={pinned ? `Unpin ${product.name}` : `Pin ${product.name}`}
        aria-pressed={pinned}
      >
        <Star className="size-3.5" fill={pinned ? 'currentColor' : 'none'} />
      </button>
      <p className="text-ink truncate pr-4 text-[13px] font-bold">{product.name}</p>
      <p className="text-muted truncate text-[11px]">{product.sub}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="tabular text-ink text-sm font-extrabold">{formatGBP(product.price)}</span>
        <span
          className={cn(
            'tabular text-[11px] font-bold',
            out ? 'text-red-deep' : productIsLowStock(product) ? 'text-warning' : 'text-muted',
          )}
        >
          {out ? 'Out' : `×${product.stockQty}`}
        </span>
      </div>
    </div>
  );
});
