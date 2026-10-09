'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartLine, Money, Product, StorefrontVariant } from '@/lib/data/types';
import { isPurchasable } from '@/lib/data/types';

/**
 * Cart / bag — pure client UI state (HARD RULE #2: no data fetching here).
 * Persisted to localStorage so the bag survives reloads. The order it produces
 * is sent through `useCreateOrder` at checkout.
 *
 * Round 5 Phase 4 #16: a line's real identity is (productId, variantId), not
 * productId alone — two different variants of the same product are always
 * two separate lines, never merged into one quantity. `lineKey` below is the
 * one place that comparison happens, so `add`/`remove`/`setQuantity` can't
 * drift from each other on what "the same line" means.
 */
function lineKey(productId: string, variantId: string | null | undefined): string {
  return `${productId}::${variantId ?? ''}`;
}

interface CartState {
  lines: CartLine[];
  isOpen: boolean;
  /**
   * `variant` omitted adds the plain product. A variation is added at its own price under its
   * own title, with its label ("Black – iPhone 13") shown beside it in the bag.
   */
  add: (
    product: Product,
    quantity?: number,
    variant?: StorefrontVariant,
    variantLabel?: string,
  ) => void;
  remove: (productId: string, variantId?: string | null) => void;
  setQuantity: (productId: string, quantity: number, variantId?: string | null) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      isOpen: false,
      add: (product, quantity = 1, variant, variantLabel) =>
        set((state) => {
          // Vapes are in-store only — never enter the bag (HARD RULE 6.2).
          if (!isPurchasable(product)) return state;
          const variantId = variant?.id ?? null;
          const key = lineKey(product.id, variantId);
          const existing = state.lines.find((l) => lineKey(l.productId, l.variantId) === key);
          if (existing) {
            return {
              lines: state.lines.map((l) =>
                lineKey(l.productId, l.variantId) === key
                  ? { ...l, quantity: l.quantity + quantity }
                  : l,
              ),
            };
          }
          const line: CartLine = {
            productId: product.id,
            variantId,
            variantLabel: variant
              ? (variantLabel ?? Object.values(variant.options).join(' – '))
              : null,
            name: variant?.name ?? product.name,
            sub: product.sub,
            slug: product.slug,
            kind: product.kind,
            unitPrice: variant?.price ?? product.price,
            quantity,
          };
          return { lines: [...state.lines, line] };
        }),
      remove: (productId, variantId = null) =>
        set((state) => ({
          lines: state.lines.filter(
            (l) => lineKey(l.productId, l.variantId) !== lineKey(productId, variantId),
          ),
        })),
      setQuantity: (productId, quantity, variantId = null) =>
        set((state) => {
          const key = lineKey(productId, variantId);
          return {
            lines:
              quantity <= 0
                ? state.lines.filter((l) => lineKey(l.productId, l.variantId) !== key)
                : state.lines.map((l) =>
                    lineKey(l.productId, l.variantId) === key ? { ...l, quantity } : l,
                  ),
          };
        }),
      clear: () => set({ lines: [] }),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
    }),
    {
      name: 'fonology-cart',
      partialize: (state) => ({ lines: state.lines }), // never persist UI open state
    },
  ),
);

/**
 * False until the bag has been read back from localStorage. Before that `lines` is the empty
 * initial state, so a page that says "Your bag's empty" on `lines.length === 0` flashed that
 * message on every load of a full bag.
 */
export function useCartHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(useCartStore.persist.hasHydrated());
    return useCartStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}

/** Derived selectors — call with the store to avoid re-render churn. */
export const selectItemCount = (state: CartState): number =>
  state.lines.reduce((n, l) => n + l.quantity, 0);

export const selectSubtotal = (state: CartState): Money =>
  state.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
