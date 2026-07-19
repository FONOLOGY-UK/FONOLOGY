import { z } from 'zod';
import { idSchema } from './common';
import { moneySchema } from './pricing';

/**
 * Shop catalogue: accessories tested at the Fonology bench, plus two special
 * product kinds handled on the PDP (Phase 2, 6.2):
 *   - `vape`  — informational only, NEVER purchasable online ("in store only"),
 *               visually distinguished in the grid, excluded from cart logic.
 *   - `plate` — number plates, purchasable but flagged as requiring document
 *               verification, which triggers an extra checkout step (6.3).
 * `art` / `tile` drive the prototype's inline-SVG product tiles and are kept so
 * the storefront reproduces exactly. Real photography (`images`) takes over when
 * Raja wires a CDN.
 */

export const productCategoryIdSchema = z.enum([
  'cases',
  'power',
  'audio',
  'protection',
  'mounts',
  'vape',
  'plates',
]);
export type ProductCategoryId = z.infer<typeof productCategoryIdSchema>;

/** Behavioural product kind — drives PDP + cart handling. */
export const productKindSchema = z.enum(['accessory', 'vape', 'plate']);
export type ProductKind = z.infer<typeof productKindSchema>;

/** Three-state stock — NEVER a count (HARD RULE: no stock numbers to customers). */
export const stockStatusSchema = z.enum(['in-stock', 'out-of-stock', 'restocking']);
export type StockStatus = z.infer<typeof stockStatusSchema>;

/** The visual treatment of a product tile in the prototype. */
export const productTileSchema = z.enum(['bone', 'red', 'dark']);
export const productArtSchema = z.enum([
  'case',
  'charger',
  'cable',
  'glass',
  'buds',
  'bank',
  'stand',
  'mount',
  'tools',
  'watch',
]);
export type ProductArt = z.infer<typeof productArtSchema>;
export type ProductTile = z.infer<typeof productTileSchema>;

export const productSchema = z.object({
  id: idSchema,
  /** URL slug for the PDP route `/shop/[slug]`. */
  slug: z.string().min(1),
  name: z.string().min(1),
  /** Short qualifier under the name, e.g. "iPhone 15 / 15 Pro". */
  sub: z.string(),
  category: productCategoryIdSchema,
  kind: productKindSchema,
  price: moneySchema,
  stockStatus: stockStatusSchema,
  /** Optional merchandising badge, e.g. "Bestseller", "New in". */
  tag: z.string().nullable(),
  /** Device compatibility shown on the PDP where relevant. */
  compatibility: z.string().nullable(),
  /** Longer copy shown on the product detail page. */
  description: z.string(),
  /** Bullet highlights for the PDP. */
  highlights: z.array(z.string()),
  /** Spec rows for the PDP details block. */
  specs: z.array(z.object({ label: z.string(), value: z.string() })),
  /** Real product photography (empty until Raja wires a CDN → grey placeholders). */
  images: z.array(z.string().url()),
  /** Prototype fallback art. */
  art: productArtSchema,
  tile: productTileSchema,
});
export type Product = z.infer<typeof productSchema>;

/* ---- derived helpers (single source of truth for card + PDP + cart) ---- */

/** Vapes are display-only; everything else can be sold online (stock allowing). */
export const isPurchasable = (p: Pick<Product, 'kind'>): boolean => p.kind !== 'vape';

/** Whether the customer can actually add this to the bag right now. */
export const canAddToCart = (p: Pick<Product, 'kind' | 'stockStatus'>): boolean =>
  isPurchasable(p) && p.stockStatus === 'in-stock';

/** Number plates need ID/document verification at checkout. */
export const requiresVerification = (p: Pick<Product, 'kind'>): boolean => p.kind === 'plate';

/** Customer-facing stock label — never a number. */
export function stockLabel(status: StockStatus): string {
  switch (status) {
    case 'in-stock':
      return 'In stock';
    case 'out-of-stock':
      return 'Out of stock';
    case 'restocking':
      return 'Restocking';
  }
}

export const categorySchema = z.object({
  id: z.union([z.literal('all'), productCategoryIdSchema]),
  label: z.string().min(1),
});
export type Category = z.infer<typeof categorySchema>;

/** Query parameters the shop listing understands (URL-state friendly). */
export const productQuerySchema = z.object({
  category: z.union([z.literal('all'), productCategoryIdSchema]).optional(),
  search: z.string().optional(),
  sort: z.enum(['featured', 'price-asc', 'price-desc']).optional(),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;
