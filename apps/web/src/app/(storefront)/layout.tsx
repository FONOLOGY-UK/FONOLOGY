import type { ReactNode } from 'react';
import '@/styles/storefront.css';
import '@/styles/storefront-extend.css';
import { SmoothScrollProvider } from '@/components/storefront/smooth-scroll';
import { Grain } from '@/components/storefront/grain';
import { Nav } from '@/components/storefront/nav';
import { CartDrawer } from '@/components/storefront/cart-drawer';

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
 */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <SmoothScrollProvider>
      <Grain />
      <Nav />
      <main id="main">{children}</main>
      <CartDrawer />
    </SmoothScrollProvider>
  );
}
