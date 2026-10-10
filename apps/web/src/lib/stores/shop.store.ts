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

/** The message every blocked change shows while "All shops" is selected. */
export const ALL_SHOPS_VIEW_ONLY_MESSAGE = 'Please select a specific shop first to make changes.';

/**
 * True while the dashboard is showing "All shops" — set by AllShopsViewOnlyGuard, which knows the
 * EFFECTIVE choice (an owner with no shop of their own lands on All shops without choosing it).
 * The whole admin panel is view-only then: the guard stops write buttons, the API client refuses
 * to send a write, and the API refuses one that names `shop=all`.
 */
export const useAllShopsViewOnly = create<{ on: boolean; set: (on: boolean) => void }>()((set) => ({
  on: false,
  set: (on) => set({ on }),
}));

/** For the API client. */
export function isAllShopsViewOnly(): boolean {
  return useAllShopsViewOnly.getState().on;
}
