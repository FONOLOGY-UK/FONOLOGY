import { z } from 'zod';
import { moneySchema } from './pricing';

/**
 * The two inventory logs (0103, 0104) — apps/api/src/lib/inventoryLogs.ts, field for field.
 * Log A (goods in) and Log B (the change log) are separate schemas, separate endpoints and
 * separate screens: the client's rule is that they are never combined.
 */

/* ---- Log A: goods in ------------------------------------------------------ */

export const stockIntakeLineSchema = z.object({
  productId: z.string(),
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
  totalCost: moneySchema.nullable(),
});
export type StockIntake = z.infer<typeof stockIntakeSchema>;

/** POST /pos/stock-intakes. A line with no unitCost keeps the product's current cost. */
export interface StockIntakeInput {
  supplierName?: string;
  supplierRef?: string;
  notes?: string;
  lines: { productId: string; variantId: string | null; qty: number; unitCost?: number | null }[];
}

/* ---- Log B: the change log ------------------------------------------------ */

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
  /** For a stock change: "Till sale FNL-10421", "Goods in GIN-1004", "Correction". */
  cause: z.string().nullable(),
  note: z.string().nullable(),
  /** Null = no person attached (an online order, a system change). */
  actorName: z.string().nullable(),
});
export type InventoryChange = z.infer<typeof inventoryChangeSchema>;

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
export type PagedInventoryChanges = z.infer<typeof pagedInventoryChangesSchema>;

/** The filters both log pages share; each page's PDF is asked for with the same ones. */
export interface InventoryLogQuery {
  from?: string;
  to?: string;
  search?: string;
  /** Log B only. */
  type?: InventoryChangeType;
}
