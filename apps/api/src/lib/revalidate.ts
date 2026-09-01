import { config } from '../config.js';

/**
 * Client-reported bug: moving a product out of the vape category let it be
 * added to cart and ordered fine (the server-side purchasability check,
 * `product_is_purchasable_online()`, reads `kind`, which
 * `products_derive_kind` (0064_mandatory_categories.sql) recomputes from
 * `category_id` on every update — so the DB is correct the instant the
 * category change commits) but its own product detail page kept showing
 * the in-store-only messaging.
 *
 * Root cause: `/shop/[slug]` (apps/web) is fully static —
 * `generateStaticParams` + `dynamicParams = false`, no `revalidate` — built
 * once and served from that build forever. The PDP's "is this purchasable"
 * check (`isPurchasable`, product.ts) reads the exact same `kind` field the
 * database check does; the two were never computing it differently, one of
 * them was just reading it from build time. Cart and checkout call the live
 * API on every request, so they always saw the current value; the PDP
 * didn't until the next full rebuild.
 *
 * Fix: tell the PDP to actually invalidate the moment the category change
 * that matters lands, rather than trusting a rebuild to happen eventually.
 * apps/web exposes `POST /api-internal/revalidate-product` for exactly
 * this — see that route's own comment. Fire-and-forget, same posture as
 * lib/email.ts: a revalidation hiccup must never fail the product update
 * that triggered it, and there is nothing a caller could usefully retry
 * here anyway (the DB write already succeeded; worst case the PDP is stale
 * until the next request the storefront happens to trigger a revalidation
 * from, or the next deploy).
 */
export function revalidateProductPage(slug: string): void {
  if (!config.internalProxySecret) return; // no secret configured -> no shared trust with apps/web; skip silently
  void fetch(`${config.webAppUrl}/api-internal/revalidate-product`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-proxy-secret': config.internalProxySecret,
    },
    body: JSON.stringify({ slug }),
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`[api] revalidateProductPage(${slug}) failed:`, err);
  });
}
