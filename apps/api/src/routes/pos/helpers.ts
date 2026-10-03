import { db, rpc } from '../../lib/db.js';
import type { CashEntryKind } from '../../db/types.js';
import { staffNamesFor } from '../../lib/staffNames.js';

export function mapCashKindIn(input: 'float-open' | 'petty-in' | 'petty-out'): CashEntryKind {
  return (
    { 'float-open': 'float_open', 'petty-in': 'petty_in', 'petty-out': 'petty_out' } as const
  )[input];
}
export function mapCashKindOut(db: string): string {
  return { float_open: 'float-open', petty_in: 'petty-in', petty_out: 'petty-out' }[db] ?? db;
}

export interface SaleLineRow {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  list_price: number;
  cost_price: number;
  tier_applied: boolean;
  sub: string | null;
}

export async function toApiSale(
  saleRow: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const saleId = saleRow.id as string;
  const [lineRows, paymentRows] = await Promise.all([
    db
      .selectFrom('sale_lines')
      .leftJoin('products', 'products.id', 'sale_lines.product_id')
      .select([
        'sale_lines.id',
        'sale_lines.product_id',
        'sale_lines.variant_id',
        'sale_lines.name',
        'sale_lines.quantity',
        'sale_lines.unit_price',
        'sale_lines.list_price',
        'sale_lines.cost_price',
        'sale_lines.tier_applied',
        'products.sub',
      ])
      .where('sale_lines.sale_id', '=', saleId)
      .execute(),
    db
      .selectFrom('sale_payments')
      .select(['tender', 'amount'])
      .where('sale_id', '=', saleId)
      .execute(),
  ]);

  const lines = (lineRows as SaleLineRow[]).map((l) => ({
    productId: l.product_id ?? l.id,
    // Round 5 Phase 4 #16: null for every line that isn't a variant —
    // unchanged shape otherwise.
    variantId: l.variant_id,
    name: l.name,
    sub: l.sub ?? '',
    quantity: l.quantity,
    unitPrice: l.unit_price,
    listPrice: l.list_price,
    costPrice: l.cost_price,
    tierApplied: l.tier_applied,
  }));

  return {
    id: saleRow.id,
    reference: saleRow.reference,
    lines,
    subtotal: saleRow.subtotal,
    discount: saleRow.discount,
    total: saleRow.total,
    cost: saleRow.cost,
    belowCost: saleRow.below_cost,
    belowCostReason: saleRow.below_cost_reason,
    payments: paymentRows.map((p) => ({ tender: p.tender, amount: p.amount })),
    at: saleRow.created_at,
  };
}

/**
 * Shapes one refunds row for the API.
 *
 * `names` lets the list endpoint resolve every staff name in a single query
 * and pass the map in; without it (the single-refund POST path) the one name
 * needed is looked up here. The screen must never have to join staff itself —
 * it only ever receives an id, and demanding a name it was never sent is
 * exactly what left /admin/cash stuck on a skeleton.
 */
export async function toApiRefund(
  refundRow: Record<string, unknown>,
  names?: Map<string, string>,
): Promise<Record<string, unknown>> {
  const lineRows = await db
    .selectFrom('refund_lines')
    .select(['product_id', 'variant_id', 'name', 'quantity', 'unit_price', 'restocked'])
    .where('refund_id', '=', refundRow.id as string)
    .execute();

  const staffId = (refundRow.staff_id as string | null) ?? null;
  const resolved = names ?? (await staffNamesFor([staffId]));

  let source: 'order' | 'counter' | 'no-receipt' = 'no-receipt';
  let reference: string | null = null;
  if (refundRow.sale_id) {
    source = 'counter';
    const sale = await db
      .selectFrom('sales')
      .select('reference')
      .where('id', '=', refundRow.sale_id as string)
      .executeTakeFirst();
    reference = sale?.reference ?? null;
  } else if (refundRow.order_id) {
    source = 'order';
    const order = await db
      .selectFrom('orders')
      .select('reference')
      .where('id', '=', refundRow.order_id as string)
      .executeTakeFirst();
    reference = order?.reference ?? null;
  }

  return {
    id: refundRow.id,
    source,
    /**
     * The ORIGINAL sale/order reference this refund was taken against. Kept
     * with this name because that is what the returns screen has always shown
     * and searched by — renaming it would break the screen for the sake of
     * tidiness.
     */
    reference,
    /**
     * This refund's OWN reference (REF- series, migration 0035).
     *
     * Added because a refund receipt is a document the customer keeps, and
     * before 0035 two partial refunds against one sale printed the same FNL-
     * number — indistinguishable on paper. Both appear on the printed refund
     * receipt, answering two different questions.
     */
    refundReference: refundRow.reference ?? null,
    lines: lineRows.map((l) => ({
      productId: l.product_id,
      variantId: l.variant_id,
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unit_price,
    })),
    amount: refundRow.amount,
    reason: refundRow.reason,
    tender: refundRow.refund_tender,
    // originalTender is server-derived (from the sale's own sale_payments),
    // never client-supplied.
    originalTender: refundRow.original_tender ?? null,
    restock: lineRows.some((l) => l.restocked),
    staffId,
    staffName: staffId ? (resolved.get(staffId) ?? null) : null,
    outsideWindow: refundRow.outside_window,
    windowOverrideBy: refundRow.window_override_by,
    at: refundRow.created_at,
    withinWindow: !refundRow.outside_window,
  };
}

/** The shop's trading day right now, per shop_day() — Europe/London, never the server clock. */
export function shopDayNow(): Promise<string> {
  return rpc<string>('shop_day', { ts: new Date().toISOString() });
}

/** Reference -> entity id via reference_registry, scoped to one entity_type. */
export async function resolveReference(
  reference: string,
  entityType: 'sale' | 'order',
): Promise<string | null> {
  const data = await db
    .selectFrom('reference_registry')
    .select(['entity_id', 'entity_type'])
    .where('reference', '=', reference.trim().toUpperCase())
    .executeTakeFirst();
  if (!data || data.entity_type !== entityType) return null;
  return data.entity_id;
}
