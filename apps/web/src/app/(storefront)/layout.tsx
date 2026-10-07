import type { ReactNode } from 'react';
import '@/styles/storefront.css';
import '@/styles/storefront-extend.css';
import { SmoothScrollProvider } from '@/components/storefront/smooth-scroll';
import { Grain } from '@/components/storefront/grain';
import { Nav } from '@/components/storefront/nav';
import { CartDrawer } from '@/components/storefront/cart-drawer';
import { PromoBar } from '@/components/storefront/promo-bar';
import { getShopDetails } from '@/lib/shop-details';

/**
 * Storefront shell — the chrome shared by every storefront route: smooth
 * scroll, film grain, fixed nav + overlay menu, and the cart drawer. Ported
 * from the prototype's shared markup, NOT redesigned (HR#1).
 *
 * The prototype's custom dot+ring cursor was REMOVED on request — the native
 * OS cursor is used everywhere (see storefront-extend.css). The `data-cursor`
 * attributes left in the markup are inert; they cost nothing and keep the
 * diff against the prototype small.
 *
 * The footer is rendered per-page (full vs slim), mirroring the prototype where
 * each page carries its own footer variant. Storefront pages are Server
 * Components by default; interactivity/animation lives in nested Client
 * Components.
 *
 * The free-delivery strip (0102) sits above the nav. --promo-h is only set when
 * it actually renders, so with no threshold the layout is exactly as before.
 */
export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const shop = await getShopDetails();
  const promo = shop.freeDeliveryThreshold != null;
  return (
    <SmoothScrollProvider>
      {promo ? <style>{':root{--promo-h:32px}'}</style> : null}
      <Grain />
      <PromoBar shop={shop} />
      <Nav />
      <main id="main">{children}</main>
      <CartDrawer />
    </SmoothScrollProvider>
  );
}
