'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { useSession, useShops } from '@/lib/data/hooks';
import { useShopSelection } from '@/lib/stores/shop.store';

/**
 * Which shop the dashboard is showing — for owners and managers, who can see more than one.
 *
 * "All shops" combines every shop's figures and lists (and the API refuses a change made while it
 * is chosen, so nothing lands in the wrong shop by accident). Picking your own shop clears the
 * choice, which is also what the dashboard showed before there were shops. Employees never see
 * this: the server keeps them in their own shop whatever the browser asks for.
 *
 * Switching refreshes everything on screen, because every list and total is per shop.
 */
export function ShopSwitcher() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const selected = useShopSelection((s) => s.selected);
  const select = useShopSelection((s) => s.select);

  const staff = session?.kind === 'staff' ? session : null;
  const seesMany = staff !== null && staff.staffRole !== 'employee';
  const { data: shops } = useShops({ enabled: seesMany });

  if (!staff || !seesMany || !shops || shops.length < 2) return null;

  const own = staff.shopId ?? null;
  // A remembered choice for a shop that has since closed falls back to the default.
  const known = selected === 'all' || shops.some((s) => s.id === selected);
  const value = (known ? selected : null) ?? own ?? 'all';

  return (
    <div className="border-b border-white/10 px-3 py-3">
      <label className="text-bone/40 mb-1 flex items-center gap-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.2em]">
        <Store className="size-3" aria-hidden="true" />
        Viewing
      </label>
      <select
        aria-label="Shop to view"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          select(next === (own ?? 'all') ? null : next);
          void queryClient.invalidateQueries();
        }}
        className="text-bone w-full rounded-md border border-white/15 bg-white/[0.06] px-2.5 py-2 text-[13px] font-semibold outline-none focus:border-white/40"
      >
        {shops.map((shop) => (
          <option key={shop.id} value={shop.id} className="text-ink">
            {shop.name}
            {shop.id === own ? ' (yours)' : ''}
          </option>
        ))}
        <option value="all" className="text-ink">
          All shops
        </option>
      </select>
      {value === 'all' ? (
        <p className="text-bone/45 mt-1.5 px-2 text-[11px] leading-snug">
          Combined view. Pick a shop to add or change anything.
        </p>
      ) : null}
    </div>
  );
}
