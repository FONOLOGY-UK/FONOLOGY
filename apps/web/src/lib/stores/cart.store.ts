'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartLine, Money, Product } from '@/lib/data/types';

/**
 * Cart / bag — pure client UI state (HARD RULE #2: no data fetching here).
 * Persisted to localStorage so the bag survives reloads. The order it produces
 * is sent through `useCreateOrder` at checkout.
 */
interface CartState {
  lines: CartLine[];
  isOpen: boolean;
  add: (product: Product, quantity?: number) => void;
  remove: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
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
      add: (product, quantity = 1) =>
        set((state) => {
          const existing = state.lines.find((l) => l.productId === product.id);
          if (existing) {
            return {
              lines: state.lines.map((l) =>
                l.productId === product.id ? { ...l, quantity: l.quantity + quantity } : l,
              ),
            };
          }
          const line: CartLine = {
            productId: product.id,
            name: product.name,
            sub: product.sub,
            unitPrice: product.price,
            quantity,
          };
          return { lines: [...state.lines, line] };
        }),
      remove: (productId) =>
        set((state) => ({ lines: state.lines.filter((l) => l.productId !== productId) })),
      setQuantity: (productId, quantity) =>
        set((state) => ({
          lines:
            quantity <= 0
              ? state.lines.filter((l) => l.productId !== productId)
              : state.lines.map((l) => (l.productId === productId ? { ...l, quantity } : l)),
        })),
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

/** Derived selectors — call with the store to avoid re-render churn. */
export const selectItemCount = (state: CartState): number =>
  state.lines.reduce((n, l) => n + l.quantity, 0);

export const selectSubtotal = (state: CartState): Money =>
  state.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
