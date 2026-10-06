'use client';

import { useSession, useShops } from '@/lib/data/hooks';

/**
 * The shop this till belongs to (the signed-in person's own), and whether it is the hub —
 * the shop that handles online orders, repair requests and sell requests (multi-shop design;
 * bug report v1, BUG-003). `isHub` is `undefined` until both the session and the shop list
 * have loaded, so callers can wait rather than flash the wrong tabs.
 *
 * Display only, like every permission check in this app: the API already files every online
 * request under the hub and scopes the lists and the per-request routes to the caller's shop.
 */
export function useTillShop() {
  const { data: session } = useSession();
  const isStaff = session?.kind === 'staff';
  const { data: shops } = useShops({ enabled: isStaff });
  if (!isStaff || !shops) return { shop: undefined, isHub: undefined };
  // An owner with no shop of their own sees everything, as the hub does.
  if (!session.shopId) return { shop: undefined, isHub: true };
  const shop = shops.find((s) => s.id === session.shopId);
  return { shop, isHub: shop?.isHub ?? false };
}
