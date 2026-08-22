import { z } from 'zod';
import { idSchema } from './common';
import { moneySchema } from './pricing';
import {
  productCategoryIdSchema,
  productKindSchema,
  productSchema,
  type StockStatus,
} from './product';

/**
 * Inventory — the admin-side truth about a product (item 7, Inventory module).
 *
 * The storefront only ever sees the three-state `stockStatus` (never a count).
 * Admin sees the real numbers: exact quantity, cost price, supplier, barcode.
 * `AdminProduct` is the catalogue Product plus that private layer.
 */

export const stockMetaSchema = z.object({
  /** What Fonology paid per unit, in pence — drives margin. */
  costPrice: moneySchema,
  stockQty: z.number().int().min(0),
  /** Supplier name; null when the item was bought in locally. */
  supplier: z.string().nullable(),
  /**
   * Locally-bought stock (e.g. trade-ins resold). When true there is no
   * supplier — instead a signed buy-in form is uploaded and kept on record.
   */
  localBuying: z.boolean(),
  /** Upload ref for the signed buy-in form (mock: filename only). */
  buyInForm: z.string().nullable(),
  /** EAN/UPC/code as scanned — USB HID scanners type into this field. */
  barcode: z.string().nullable(),
  /**
   * Per-product low-stock alerting. Moved off the global Settings dial so each
   * product carries its own rule: a fast-moving cable and a rarely-sold plate
   * shouldn't share one threshold. `lowStockAlert` is the on/off; when off, no
   * alert regardless of `lowStockThreshold`.
   */
  lowStockAlert: z.boolean(),
  lowStockThreshold: z.number().int().min(1),
});
export type StockMeta = z.infer<typeof stockMetaSchema>;

export const adminProductSchema = productSchema.merge(stockMetaSchema).extend({
  /**
   * Whether the product is listed. `deleteProduct` deactivates rather than
   * hard-deleting (history has to keep its rows), so without this the screen
   * had no way to tell a live product from one it had just retired — the API
   * was sending it and the schema was silently dropping it. Optional because
   * the mock db predates the column.
   */
  isActive: z.boolean().optional(),
  /**
   * Sellable at the till, absent from the storefront (0044, FEATURE-06).
   * Optional for the same reason `isActive` is — older mock data predates
   * the column. Undefined reads the same as false: visible everywhere.
   */
  inStoreOnly: z.boolean().optional(),
  /**
   * categories.id (FEATURE-05, migration 0045) — the real id behind the
   * `category` slug this row already carries from `productSchema`. `category`
   * stays a display slug (used for the storefront's filter/URL contract
   * too); editing a product needs the real id, which a slug alone can't
   * give when two categories could theoretically share display intent.
   * Optional only so older cached admin rows fetched before this field
   * existed don't fail validation.
   */
  categoryId: z.string().min(1).optional(),
});
export type AdminProduct = z.infer<typeof adminProductSchema>;

/** Form payload for product create/edit. Images are an upload UI mock. */
export const productInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a product name'),
    sub: z.string().trim().min(2, 'Enter the short line under the name'),
    /** categories.id — was a fixed enum value; see productCategoryIdSchema's comment. */
    categoryId: z.string().min(1, 'Choose a category'),
    kind: productKindSchema,
    price: moneySchema.positive('Enter a selling price'),
    costPrice: moneySchema.min(0, 'Enter the cost price'),
    stockQty: z.number().int().min(0, 'Stock cannot be negative'),
    /** When qty is 0: true = show "Restocking", false = "Out of stock". */
    restocking: z.boolean(),
    supplier: z.string().trim().optional(),
    localBuying: z.boolean(),
    buyInForm: z.string().optional(),
    barcode: z.string().trim().optional(),
    /** Per-product low-stock alert (see StockMeta). Threshold ignored when off. */
    lowStockAlert: z.boolean(),
    lowStockThreshold: z.number().int().min(1, 'Threshold must be at least 1'),
    /** Sellable at the till, hidden from the storefront (FEATURE-06). */
    inStoreOnly: z.boolean(),
    description: z.string().trim().min(10, 'A sentence or two for the product page'),
    tag: z.string().trim().optional(),
    compatibility: z.string().trim().optional(),
    /** Upload UI mock — filename refs only until Raja wires storage. */
    images: z.array(z.string()),
  })
  // Names the way out, not just the thing that's missing: stock with no
  // supplier is legitimate (it was bought locally), and someone who doesn't
  // already know that reads a bare "enter the supplier name" as a wall.
  .refine((v) => v.localBuying || (v.supplier && v.supplier.length > 1), {
    message: "Enter a supplier name, or tick 'Bought locally'",
    path: ['supplier'],
  })
  .refine((v) => !v.localBuying || (v.buyInForm && v.buyInForm.length > 0), {
    message: 'Upload the signed buy-in form',
    path: ['buyInForm'],
  });
export type ProductInput = z.infer<typeof productInputSchema>;

/** Storefront status derived from the real count (admin edits qty, not status). */
export function deriveStockStatus(stockQty: number, restocking: boolean): StockStatus {
  if (stockQty > 0) return 'in-stock';
  return restocking ? 'restocking' : 'out-of-stock';
}

/** Low stock = still in stock but at/below a threshold. Primitive used below. */
export function isLowStock(stockQty: number, threshold: number): boolean {
  return stockQty > 0 && stockQty <= threshold;
}

/**
 * Per-product low-stock check — the one to use everywhere now. A product is
 * "low" only when its own alert is switched on and it sits at/below its own
 * threshold. Products with the alert off are never flagged.
 */
export function productIsLowStock(
  product: Pick<StockMeta, 'stockQty' | 'lowStockAlert' | 'lowStockThreshold'>,
): boolean {
  return product.lowStockAlert && isLowStock(product.stockQty, product.lowStockThreshold);
}

/**
 * One row from `GET /admin/products/low-stock` — backed by the DB view
 * `low_stock_products` (0043), which already applies exactly the same rule as
 * `productIsLowStock()` above (active, alert on, still in stock, at/below
 * threshold). The Overview dashboard reads this instead of recomputing the
 * check client-side over the full product list, which used to leak retired
 * products into the count (see BUG-04).
 */
export const lowStockProductSchema = z.object({
  id: idSchema,
  name: z.string(),
  category: productCategoryIdSchema,
  stockQty: z.number().int(),
  lowStockThreshold: z.number().int(),
});
export type LowStockProduct = z.infer<typeof lowStockProductSchema>;

/**
 * A category, as the admin management screen sees it (FEATURE-05, migration
 * 0045) — the real row, not the display-only slug+label pair every product
 * carries. `parentId` null = top-level; set = a subcategory. One level is
 * all the admin UI offers (see categoryInputSchema), even though the schema
 * itself doesn't stop a deeper tree.
 */
export const adminCategorySchema = z.object({
  id: idSchema,
  label: z.string().min(1),
  slug: z.string().min(1),
  parentId: idSchema.nullable(),
  createdAt: z.string(),
});
export type AdminCategory = z.infer<typeof adminCategorySchema>;

/**
 * Category create/edit. `slug` is deliberately absent — the server derives
 * it from `label`, same as a product's own slug, and never re-derives it on
 * rename (it's the storefront's URL/filter contract; see the API's own
 * categoryInputBodySchema comment).
 */
export const categoryInputSchema = z.object({
  label: z.string().trim().min(1, 'Enter a category name'),
  parentId: idSchema.nullable().optional(),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

/** Margin on one unit as a fraction of the selling price (0.42 = 42%). */
export function unitMargin(price: number, costPrice: number): number {
  if (price <= 0) return 0;
  return (price - costPrice) / price;
}
