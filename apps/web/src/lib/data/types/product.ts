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
 * the storefront reproduces exactly. Real photography (`images`) takes over when a
 * product has photos.
 */

/**
 * A category's slug — was a fixed 7-value enum; categories are now an
 * admin-editable table (FEATURE-05, migration 0045), so this is open-ended.
 * Display/filter only: identifies a category by its slug wherever a product
 * shows or is filtered by category. Editing a product's category needs the
 * real id, not the slug — see AdminProduct.categoryId (types/inventory.ts).
 */
export const productCategoryIdSchema = z.string().min(1);
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

/**
 * A variation on the product page (0107). Every detail is already resolved against the parent —
 * its own where the admin set one, the parent's otherwise — and, like the parent, never a stock
 * count: three-state status only. Admin shapes are in variations.ts.
 */
export const storefrontVariantSchema = z.object({
  id: idSchema,
  options: z.record(z.string()),
  price: moneySchema,
  stockStatus: stockStatusSchema,
  name: z.string(),
  description: z.string(),
  tag: z.string().nullable(),
  compatibility: z.string().nullable(),
  images: z.array(z.string().url()),
});
export type StorefrontVariant = z.infer<typeof storefrontVariantSchema>;

export const storefrontVariationsSchema = z.object({
  /** In the admin's order; only values some enabled variation uses. */
  types: z.array(
    z.object({
      name: z.string(),
      /** Colour options show swatches, the others pills. */
      isColour: z.boolean(),
      values: z.array(z.object({ value: z.string(), swatchHex: z.string().nullable() })),
    }),
  ),
  variants: z.array(storefrontVariantSchema),
  /** The variation the page opens on. */
  defaultVariantId: idSchema.nullable(),
});
export type StorefrontVariations = z.infer<typeof storefrontVariationsSchema>;

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
  /** Real product photography (empty → grey placeholders). */
  images: z.array(z.string().url()),
  /** Prototype fallback art. */
  art: productArtSchema,
  tile: productTileSchema,
  /**
   * Sent on EVERY product response, list and single: the grid card needs it too, because the
   * parent of a variation product is never for sale itself — a "quick add" must send the
   * customer to the product page to choose. On a card, `price` and `images` are already the
   * default variation's.
   */
  hasVariants: z.boolean().optional(),
  /** The product page's picker (0107). Only on the single-product read. */
  variations: storefrontVariationsSchema.optional(),
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

/**
 * Round 5 Phase 4 #16: does this product need a variant picked before it
 * can be added? Checks the cheap `hasVariants` flag (sent on every product
 * response) rather than `variants` itself — that array is only ever
 * populated on the single-product PDP read, so checking its length alone
 * would read every grid-card product as variant-free even when it isn't.
 */
export const hasVariants = (p: Pick<Product, 'hasVariants'>): boolean => Boolean(p.hasVariants);

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
  /**
   * Round 5 #10: the slug of the parent category this one nests under, or
   * `null`/omitted for a top-level category (and always omitted for the
   * synthetic "all" entry, which isn't a real category row). `GET
   * /categories` used to filter to parent_id is null only — it now returns
   * every category, top-level and sub, so the storefront can build the
   * secondary subcategory row itself.
   */
  parentId: z.string().nullable().optional(),
});
export type Category = z.infer<typeof categorySchema>;

/** Query parameters the shop listing understands (URL-state friendly). */
export const productQuerySchema = z.object({
  category: z.union([z.literal('all'), productCategoryIdSchema]).optional(),
  search: z.string().optional(),
  sort: z.enum(['featured', 'price-asc', 'price-desc']).optional(),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;
