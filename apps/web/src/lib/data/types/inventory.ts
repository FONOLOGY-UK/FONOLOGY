import { z } from 'zod';
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
});
export type StockMeta = z.infer<typeof stockMetaSchema>;

export const adminProductSchema = productSchema.merge(stockMetaSchema);
export type AdminProduct = z.infer<typeof adminProductSchema>;

/** Form payload for product create/edit. Images are an upload UI mock. */
export const productInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a product name'),
    sub: z.string().trim().min(2, 'Enter the short line under the name'),
    category: productCategoryIdSchema,
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
    description: z.string().trim().min(10, 'A sentence or two for the product page'),
    tag: z.string().trim().optional(),
    compatibility: z.string().trim().optional(),
    /** Upload UI mock — filename refs only until Raja wires storage. */
    images: z.array(z.string()),
  })
  .refine((v) => v.localBuying || (v.supplier && v.supplier.length > 1), {
    message: 'Enter the supplier name',
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

/** Low stock = still in stock but at/below the alert threshold (Settings, default 5). */
export function isLowStock(stockQty: number, threshold: number): boolean {
  return stockQty > 0 && stockQty <= threshold;
}

/** Margin on one unit as a fraction of the selling price (0.42 = 42%). */
export function unitMargin(price: number, costPrice: number): number {
  if (price <= 0) return 0;
  return (price - costPrice) / price;
}
