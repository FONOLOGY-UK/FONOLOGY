import { z } from 'zod';
import { idSchema } from './common';
import { moneySchema } from './pricing';

/**
 * Shop catalogue: accessories tested at the Fonology bench.
 * `art` / `tile` drive the prototype's inline-SVG product tiles and are kept
 * so the storefront reproduces exactly. When Raja adds real imagery, `images`
 * takes over and `art`/`tile` become an optional fallback.
 */

export const productCategoryIdSchema = z.enum(['cases', 'power', 'audio', 'protection', 'mounts']);
export type ProductCategoryId = z.infer<typeof productCategoryIdSchema>;

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
  price: moneySchema,
  /** Optional merchandising badge, e.g. "Bestseller", "New in". */
  tag: z.string().nullable(),
  inStock: z.boolean(),
  /** Longer copy shown on the product detail page. */
  description: z.string(),
  /** Bullet highlights for the PDP. */
  highlights: z.array(z.string()),
  /** Real product photography (empty until Raja wires a CDN). */
  images: z.array(z.string().url()),
  /** Prototype fallback art. */
  art: productArtSchema,
  tile: productTileSchema,
});
export type Product = z.infer<typeof productSchema>;

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
