'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Which shop an owner or manager is LOOKING AT in the dashboard.
 *
 *   null     — their own shop (the default; what the dashboard showed before there were shops)
 *   'all'    — every shop combined (reads only; a change needs a real shop, and the API says so)
 *   <uuid>   — that shop
 *
 * Employees never use it: the server pins them to their own shop whatever is asked. This is only
 * a convenience for the people who can see more than one — the server decides what they may see.
 */
interface ShopSelectionState {
  selected: string | null;
  select: (value: string | null) => void;
}

export const useShopSelection = create<ShopSelectionState>()(
  persist(
    (set) => ({
      selected: null,
      select: (selected) => set({ selected }),
    }),
    { name: 'fnl-shop-selection' },
  ),
);

/** For code outside React (the API client). */
export function currentShopSelection(): string | null {
  return useShopSelection.getState().selected;
}
