import { z } from 'zod';
import { moneySchema } from './pricing';
import { adminProductSchema } from './inventory';

/**
 * The two inventory logs (0103, 0104) — apps/api/src/lib/inventoryLogs.ts, field for field.
 * Log A (goods in) and Log B (the change log) are separate schemas, separate endpoints and
 * separate screens: the client's rule is that they are never combined.
 */

/* ---- Log A: goods in ------------------------------------------------------ */

export const stockIntakeLineSchema = z.object({
  /** Null on a typed item (0108); set on a line booked before then. */
  productId: z.string().nullable(),
  variantId: z.string().nullable(),
  name: z.string(),
  variantLabel: z.string().nullable(),
  qty: z.number().int(),
  /** Null for anyone without costs.view. */
  unitCost: moneySchema.nullable(),
});
export type StockIntakeLine = z.infer<typeof stockIntakeLineSchema>;

export const stockIntakeSchema = z.object({
  id: z.string(),
  reference: z.string(),
  shopId: z.string(),
  shopName: z.string(),
  createdAt: z.string(),
  supplierName: z.string().nullable(),
  supplierRef: z.string().nullable(),
  notes: z.string().nullable(),
  staffName: z.string(),
  lines: z.array(stockIntakeLineSchema),
  unitCount: z.number().int(),
  /** The delivery's price (0108; the sum of its line costs before then). Null for anyone without costs.view, or not given. */
  totalCost: moneySchema.nullable(),
});
export type StockIntake = z.infer<typeof stockIntakeSchema>;

/**
 * One line of a delivery (0123, client changes Oct 2026 #8):
 *   product — its quantity is added to stock; registerBarcodes = barcodes scanned or typed that
 *             nothing had, now put on this product or variation (0124);
 *   barcode — the product isn't known yet: it waits in the "to link" list, no stock moves;
 *   item    — a typed note only.
 * unitCost is pence per item; absent = keep the product's current cost.
 */
export type GoodsInLineInput =
  | {
      type: 'product';
      productId: string;
      variantId?: string | null;
      qty: number;
      unitCost?: number | null;
      registerBarcodes?: string[];
    }
  | { type: 'barcode'; barcode: string; name?: string; qty: number; unitCost?: number | null }
  | { type: 'item'; name: string; qty: number };

/** POST /pos/stock-intakes (0123): lines, plus one optional price for the whole delivery. */
export interface StockIntakeInput {
  supplierName?: string;
  supplierRef?: string | null;
  notes?: string;
  lines: GoodsInLineInput[];
  /** Pence, for the whole delivery. */
  price?: number | null;
}

/** POST /pos/goods-in/products — the quick "new product" form on Goods in. */
export interface GoodsInProductInput {
  name: string;
  categoryId: string;
  /** Selling price, pence. */
  price: number;
  barcode?: string;
  generateBarcode?: boolean;
  /** A mobile phone: one IMEI per handset that arrived; each becomes its own variation. */
  imeis?: string[];
}

/** What the quick form made: the product, plus a new phone's handsets (one variation each). */
export const goodsInCreatedProductSchema = adminProductSchema.extend({
  handsets: z.array(z.object({ variantId: z.string(), imei: z.string() })).default([]),
});
export type GoodsInCreatedProduct = z.infer<typeof goodsInCreatedProductSchema>;

/** A barcode from a delivery waiting for its product (0123). */
export const toLinkBarcodeSchema = z.object({
  id: z.string(),
  barcode: z.string(),
  name: z.string().nullable(),
  qty: z.number().int(),
  createdAt: z.string(),
  intakeReference: z.string().nullable(),
  supplierName: z.string().nullable(),
  staffName: z.string(),
});
export type ToLinkBarcode = z.infer<typeof toLinkBarcodeSchema>;

/** The Goods in barcode register — the audit report (0123). */
export const registeredBarcodeSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  shopName: z.string(),
  barcode: z.string(),
  itemName: z.string().nullable(),
  status: z.enum(['linked', 'to_link', 'dismissed']),
  productName: z.string().nullable(),
  variantLabel: z.string().nullable(),
  qty: z.number().int(),
  unitCost: moneySchema.nullable(),
  intakeReference: z.string(),
  staffName: z.string(),
  linkedByName: z.string().nullable(),
  linkedAt: z.string().nullable(),
});
export type RegisteredBarcode = z.infer<typeof registeredBarcodeSchema>;
export type BarcodeRegisterFilter = 'linked' | 'to_link';

/* ---- Log B: the change log ------------------------------------------------ */

/** Client changes, Oct 2026 #4: an entry checked (reviewed) or flagged by an admin (0120). */
export const changeReviewSchema = z.object({
  status: z.enum(['checked', 'flagged']),
  byName: z.string(),
  at: z.string(),
});
export type ChangeReview = z.infer<typeof changeReviewSchema>;

export const inventoryChangeSchema = z.object({
  id: z.string(),
  shopId: z.string(),
  shopName: z.string(),
  createdAt: z.string(),
  productId: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  change: z.enum(['created', 'field', 'stock', 'retired', 'restored']),
  /** "Price", "Stock", "Added", "Retired" ... */
  what: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  /** For a stock change: "Till sale F01-SAL-061026001", "Goods in GIN-1004", "Correction". */
  cause: z.string().nullable(),
  note: z.string().nullable(),
  /** Null = no person attached (an online order, a system change). */
  actorName: z.string().nullable(),
  /** An admin's decision on this entry (0120); null = unchecked. */
  review: changeReviewSchema.nullable(),
});
export type InventoryChange = z.infer<typeof inventoryChangeSchema>;

/** The Checked / Flagged / Unchecked toggle on the change log; undefined = All. */
export type InventoryReviewFilter = 'checked' | 'flagged' | 'unchecked';

export type InventoryChangeType = 'stock' | 'field' | 'product';

/* ---- pages and filters ---------------------------------------------------- */

const plainPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  });

export const pagedStockIntakesSchema = plainPage(stockIntakeSchema);
export type PagedStockIntakes = z.infer<typeof pagedStockIntakesSchema>;

export const pagedInventoryChangesSchema = plainPage(inventoryChangeSchema);
export const pagedRegisteredBarcodesSchema = plainPage(registeredBarcodeSchema);
export type PagedRegisteredBarcodes = z.infer<typeof pagedRegisteredBarcodesSchema>;
export type PagedInventoryChanges = z.infer<typeof pagedInventoryChangesSchema>;

/** The filters both log pages share; each page's PDF is asked for with the same ones. */
export interface InventoryLogQuery {
  from?: string;
  to?: string;
  search?: string;
  /** Log B only. */
  type?: InventoryChangeType;
  /** Log B only. */
  review?: InventoryReviewFilter;
}
