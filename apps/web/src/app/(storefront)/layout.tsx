import type { ReactNode } from 'react';

/**
 * STOREFRONT shell (route group — adds no URL segment).
 *
 * HARD RULE #1: the storefront is a faithful reproduction of the approved
 * prototype. In Phase 2 this layout gains the reproduced Nav, overlay Menu,
 * Footer, cart Drawer, film-grain/custom-cursor overlays and the Lenis smooth-
 * scroll wrapper — all ported verbatim from the prototype, NOT redesigned.
 * For now it is a neutral wrapper so every storefront route renders.
 *
 * Storefront pages are Server Components by default; interactivity/animation
 * lives in nested Client Components.
 */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return <div className="bg-paper text-ink min-h-screen">{children}</div>;
}
