import type { Request } from 'express';
import { db, sql } from './db.js';
import { canSeeCosts } from './costs.js';
import { formatPence } from './money.js';
import { shopDayRangeUtc } from './shopDay.js';

/**
 * The two inventory logs (0103, 0104), read for the admin pages, the till and the PDF exports.
 *
 * Log A (goods in) and Log B (the change log) are separate tables, separate queries and
 * separate responses on purpose — the client's one hard rule is that they are never combined.
 * Both shape their rows here, once, so a screen and its PDF can't disagree about what a row
 * says. Cost figures are only sent to people with costs.view (lib/costs.ts): goods-in unit costs
 * come back null and a cost-price change reads "Hidden".
 */

export interface LogFilters {
  /** null = every shop (an owner or manager on "All shops"). */
  shopId: string | null;
  from: string | null;
  to: string | null;
  search: string;
  /** One goods-in record only (reading back the delivery just booked). */
  id?: string;
}

export function logFilters(req: Request, shopId: string | null): LogFilters {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const q = req.query;
  return {
    shopId,
    from: typeof q.from === 'string' && day.test(q.from) ? q.from : null,
    to: typeof q.to === 'string' && day.test(q.to) ? q.to : null,
    search:
      typeof q.search === 'string'
        ? q.search
            .replace(/[%_,\\]/g, '')
            .trim()
            .slice(0, 80)
        : '',
  };
}

function dayRange(f: LogFilters) {
  return f.from || f.to ? shopDayRangeUtc(f.from ?? '2000-01-01', f.to ?? '2999-12-31') : null;
}

function variantLabel(options: unknown): string | null {
  if (!options || typeof options !== 'object') return null;
  const values = Object.values(options as Record<string, unknown>).map(String);
  return values.length > 0 ? values.join(', ') : null;
}

/* ---------------------------------------------------------------------- */
/* Log A — goods in                                                         */
/* ---------------------------------------------------------------------- */

export interface IntakeLine {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  qty: number;
  unitCost: number | null;
}

export interface Intake {
  id: string;
  reference: string;
  shopId: string;
  shopName: string;
  createdAt: string;
  supplierName: string | null;
  supplierRef: string | null;
  notes: string | null;
  staffName: string;
  lines: IntakeLine[];
  unitCount: number;
  totalCost: number | null;
}

export async function listIntakes(
  req: Request,
  f: LogFilters,
  paging: { limit: number; offset: number },
): Promise<{ items: Intake[]; total: number }> {
  const range = dayRange(f);
  const like = `%${f.search}%`;
  const narrow = <Q extends ReturnType<typeof base>>(q: Q): Q => {
    let out = q;
    if (f.shopId) out = out.where('i.shop_id', '=', f.shopId) as Q;
    if (f.id) out = out.where('i.id', '=', f.id) as Q;
    if (range) {
      out = out
        .where('i.created_at', '>=', range.start)
        .where('i.created_at', '<', range.endExclusive) as Q;
    }
    if (f.search) {
      out = out.where((eb) =>
        eb.or([
          eb('i.reference', 'ilike', like),
          eb('i.supplier_name', 'ilike', like),
          eb('i.supplier_ref', 'ilike', like),
          eb.exists(
            eb
              .selectFrom('stock_intake_lines as sl')
              .innerJoin('products as sp', 'sp.id', 'sl.product_id')
              .select('sl.id')
              .whereRef('sl.intake_id', '=', 'i.id')
              .where('sp.name', 'ilike', like),
          ),
        ]),
      ) as Q;
    }
    return out;
  };
  const base = () => db.selectFrom('stock_intakes as i');

  const [rows, count] = await Promise.all([
    narrow(base())
      .innerJoin('shops as s', 's.id', 'i.shop_id')
      .innerJoin('staff as st', 'st.id', 'i.staff_id')
      .select([
        'i.id',
        'i.reference',
        'i.shop_id',
        's.name as shop_name',
        'i.created_at',
        'i.supplier_name',
        'i.supplier_ref',
        'i.notes',
        'st.name as staff_name',
      ])
      .orderBy('i.created_at', 'desc')
      .limit(paging.limit)
      .offset(paging.offset)
      .execute(),
    narrow(base())
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow(),
  ]);

  const ids = rows.map((r) => r.id);
  const lines = ids.length
    ? await db
        .selectFrom('stock_intake_lines as l')
        .innerJoin('products as p', 'p.id', 'l.product_id')
        .leftJoin('product_variants as v', 'v.id', 'l.variant_id')
        .select([
          'l.intake_id',
          'l.product_id',
          'l.variant_id',
          'p.name',
          'v.options',
          'l.qty',
          'l.unit_cost',
        ])
        .where('l.intake_id', 'in', ids)
        .orderBy('p.name')
        .execute()
    : [];

  const costs = canSeeCosts(req);
  const items = rows.map((r): Intake => {
    const mine = lines.filter((l) => l.intake_id === r.id);
    return {
      id: r.id,
      reference: r.reference ?? '',
      shopId: r.shop_id,
      shopName: r.shop_name,
      createdAt: r.created_at,
      supplierName: r.supplier_name,
      supplierRef: r.supplier_ref,
      notes: r.notes,
      staffName: r.staff_name,
      lines: mine.map((l) => ({
        productId: l.product_id,
        variantId: l.variant_id,
        name: l.name,
        variantLabel: variantLabel(l.options),
        qty: l.qty,
        unitCost: costs ? l.unit_cost : null,
      })),
      unitCount: mine.reduce((n, l) => n + l.qty, 0),
      totalCost: costs ? mine.reduce((n, l) => n + l.qty * l.unit_cost, 0) : null,
    };
  });
  return { items, total: Number(count.count) };
}

/* ---------------------------------------------------------------------- */
/* Log B — the change log                                                   */
/* ---------------------------------------------------------------------- */

export type ChangeFilter = 'stock' | 'field' | 'product' | null;

export interface ChangeRow {
  id: string;
  shopId: string;
  shopName: string;
  createdAt: string;
  productId: string;
  productName: string;
  variantLabel: string | null;
  change: 'created' | 'field' | 'stock' | 'retired' | 'restored';
  /** What changed, in words: "Price", "Stock", "Added", "Retired" ... */
  what: string;
  before: string | null;
  after: string | null;
  /** Why, for a stock change: "Till sale F01-SAL-061026001", "Goods in GIN-1004", "Correction". */
  cause: string | null;
  note: string | null;
  /** Null when no person was attached (an online order, a system change): shown as "System". */
  actorName: string | null;
}

const FIELD_LABEL: Record<string, string> = {
  name: 'Name',
  sub: 'Subtitle',
  description: 'Description',
  category_id: 'Category',
  price: 'Price',
  cost_price: 'Cost price',
  barcode: 'Barcode',
  imei: 'IMEI',
  supplier_id: 'Supplier',
  low_stock_alert: 'Low-stock alert',
  low_stock_threshold: 'Low-stock level',
  in_store_only: 'In store only',
  tag: 'Badge',
  compatibility: 'Compatibility',
  has_variants: 'Has options',
  free_delivery: 'Always free delivery',
  options: 'Options',
  sku: 'SKU',
  price_adjustment: 'Price adjustment',
};
const MONEY_FIELDS = new Set(['price', 'cost_price', 'price_adjustment']);

const STOCK_CAUSE: Record<string, string> = {
  receipt: 'Stock added',
  buy_in: 'Trade-in',
  sale: 'Till sale',
  online_order: 'Online order',
  repair_part: 'Repair part',
  refund_restock: 'Returned to stock',
  write_off: 'Written off',
  correction: 'Correction',
};

/** source_type → the table whose `reference` names it. */
const SOURCE_TABLES = {
  sale: 'sales',
  order: 'orders',
  refund: 'refunds',
  job: 'jobs',
  trade_in_payout: 'trade_in_payouts',
  stock_intake: 'stock_intakes',
} as const;

export async function listChanges(
  req: Request,
  f: LogFilters,
  change: ChangeFilter,
  paging: { limit: number; offset: number },
): Promise<{ items: ChangeRow[]; total: number }> {
  const range = dayRange(f);
  const like = `%${f.search}%`;
  const narrow = <Q extends ReturnType<typeof base>>(q: Q): Q => {
    let out = q;
    if (f.shopId) out = out.where('l.shop_id', '=', f.shopId) as Q;
    if (range) {
      out = out
        .where('l.created_at', '>=', range.start)
        .where('l.created_at', '<', range.endExclusive) as Q;
    }
    if (change === 'stock' || change === 'field') out = out.where('l.change', '=', change) as Q;
    if (change === 'product')
      out = out.where('l.change', 'in', ['created', 'retired', 'restored']) as Q;
    if (f.search) {
      out = out.where((eb) =>
        eb.or([
          eb('l.product_name', 'ilike', like),
          eb('l.variant_label', 'ilike', like),
          eb('l.actor_name', 'ilike', like),
        ]),
      ) as Q;
    }
    return out;
  };
  const base = () => db.selectFrom('inventory_change_log as l');

  const [rows, count] = await Promise.all([
    narrow(base())
      .innerJoin('shops as s', 's.id', 'l.shop_id')
      .selectAll('l')
      .select('s.name as shop_name')
      .orderBy('l.created_at', 'desc')
      .orderBy('l.id', 'desc')
      .limit(paging.limit)
      .offset(paging.offset)
      .execute(),
    narrow(base())
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow(),
  ]);

  // Names for category / supplier ids, and references for stock-movement sources — batched.
  const idsFor = (field: string) =>
    rows
      .filter((r) => r.field === field)
      .flatMap((r) => [r.old_value, r.new_value])
      .filter((v): v is string => typeof v === 'string');
  const [categories, suppliers] = await Promise.all([
    namesById('categories', idsFor('category_id')),
    namesById('suppliers', idsFor('supplier_id')),
  ]);
  const references = new Map<string, string>();
  for (const [type, table] of Object.entries(SOURCE_TABLES)) {
    const ids = [
      ...new Set(
        rows.filter((r) => r.source_type === type && r.source_id).map((r) => r.source_id!),
      ),
    ];
    if (ids.length === 0) continue;
    const found = await sql<{ id: string; reference: string | null }>`
      select id, reference from ${sql.table(table)} where id = any(${ids}::uuid[])`.execute(db);
    for (const row of found.rows) if (row.reference) references.set(row.id, row.reference);
  }

  const costs = canSeeCosts(req);
  const show = (field: string | null, value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (field === 'cost_price' && !costs) return 'Hidden';
    if (field && MONEY_FIELDS.has(field) && typeof value === 'number') return formatPence(value);
    if (field === 'category_id' && typeof value === 'string')
      return categories.get(value) ?? 'Unknown category';
    if (field === 'supplier_id' && typeof value === 'string')
      return suppliers.get(value) ?? 'Unknown supplier';
    if (field === 'options') return variantLabel(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return JSON.stringify(value);
  };

  const items = rows.map((r): ChangeRow => {
    const kind = r.change as ChangeRow['change'];
    let what = FIELD_LABEL[r.field ?? ''] ?? r.field ?? '';
    let before = show(r.field, r.old_value);
    let after = show(r.field, r.new_value);
    let cause: string | null = null;
    if (kind === 'stock') {
      what = 'Stock';
      const ref = r.source_id ? references.get(r.source_id) : undefined;
      const label =
        r.source_type === 'stock_intake' ? 'Goods in' : (STOCK_CAUSE[r.stock_kind ?? ''] ?? null);
      cause = label ? (ref ? `${label} ${ref}` : label) : null;
    } else if (kind === 'created') {
      what = 'Added';
      before = null;
      after = null;
    } else if (kind === 'retired' || kind === 'restored') {
      what = kind === 'retired' ? 'Retired' : 'Restored';
      before = null;
      after = null;
    }
    return {
      id: r.id,
      shopId: r.shop_id,
      shopName: r.shop_name,
      createdAt: r.created_at,
      productId: r.product_id,
      productName: r.product_name,
      variantLabel: r.variant_label,
      change: kind,
      what,
      before,
      after,
      cause,
      note: r.note,
      actorName: r.actor_name,
    };
  });
  return { items, total: Number(count.count) };
}

async function namesById(
  table: 'categories' | 'suppliers',
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (unique.length === 0) return new Map();
  const rows = await db
    .selectFrom(table)
    .select(['id', 'name'])
    .where('id', 'in', unique)
    .execute();
  return new Map(rows.map((r) => [r.id, r.name]));
}
