import type { Request } from 'express';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { createRouter } from '../../lib/router.js';
import { page, paginationFields } from '../../lib/pagination.js';
import { readShop } from '../../lib/shopScope.js';
import { formatPence } from '../../lib/money.js';
import {
  listChanges,
  listIntakes,
  logFilters,
  type ChangeFilter,
  type LogFilters,
} from '../../lib/inventoryLogs.js';
import { sendLogReport } from '../../lib/pdf/logReport.js';

export const adminInventoryLogsRouter = createRouter();
const router = adminInventoryLogsRouter;

/* ---------------------------------------------------------------------- */
/* The two inventory logs (0103 goods in, 0104 change log)                  */
/* ---------------------------------------------------------------------- */
// Two pages, two lists, two PDFs — never one combined view or export, by the client's rule.
// Owners and managers (reports.view); the shop comes from the admin shop switcher (?shop=,
// readShop), so one shop or every shop, and each PDF prints exactly what its page is filtered to.

/** A PDF holds at most this many rows; the footnote says so when a period has more. */
const EXPORT_CAP = 3000;

const pagingSchema = z.object(paginationFields);

function changeFilter(req: Request): ChangeFilter {
  const t = req.query.type;
  return t === 'stock' || t === 'field' || t === 'product' ? t : null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const day = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/London',
  });

async function reportHeader(f: LogFilters, total: number, extra: string[] = []) {
  const [settings, shop] = await Promise.all([
    db.selectFrom('shop_settings').select('shop_name').executeTakeFirst(),
    f.shopId
      ? db
          .selectFrom('shops')
          .select(['name', 'code'])
          .where('id', '=', f.shopId)
          .executeTakeFirst()
      : Promise.resolve(undefined),
  ]);
  const period =
    f.from || f.to
      ? `${f.from ? day(f.from) : 'the beginning'} – ${f.to ? day(f.to) : 'today'}`
      : 'All dates';
  return {
    brand: settings?.shop_name ?? 'Fonology',
    shopSlug: (shop?.code ?? 'all').toLowerCase(),
    meta: [
      `Shop: ${shop?.name ?? 'All shops'}`,
      `Period: ${period}`,
      ...(f.search ? [`Search: "${f.search}"`] : []),
      ...extra,
      `${total} ${total === 1 ? 'entry' : 'entries'}`,
    ],
  };
}

const fileDates = (f: LogFilters) => [f.from, f.to].filter(Boolean).join('_') || 'all-dates';

const capNote = (shown: number, total: number) =>
  total > shown
    ? `Showing the latest ${shown} of ${total}. Narrow the dates to export the rest.`
    : undefined;

/* ---- Log A: goods in ---------------------------------------------------- */

router.get('/stock-intakes', requireStaff, requirePermission('reports.view'), async (req, res) => {
  const paging = pagingSchema.parse(req.query);
  const { items, total } = await listIntakes(req, logFilters(req, readShop(req)), paging);
  return res.json(page(items, total, paging.limit, paging.offset));
});

router.get(
  '/stock-intakes/pdf',
  requireStaff,
  requirePermission('reports.view'),
  async (req, res) => {
    const f = logFilters(req, readShop(req));
    const { items, total } = await listIntakes(req, f, { limit: EXPORT_CAP, offset: 0 });
    const head = await reportHeader(f, total);
    const allShops = !f.shopId;
    const costs = items.some((i) => i.totalCost !== null);

    sendLogReport(res, {
      filename: `goods-in-${head.shopSlug}-${fileDates(f)}.pdf`,
      shopName: head.brand,
      title: 'Goods in',
      meta: head.meta,
      columns: [
        { header: 'Date', width: 11 },
        { header: 'Ref', width: 9 },
        ...(allShops ? [{ header: 'Shop', width: 9 }] : []),
        { header: 'Supplier', width: 14 },
        { header: 'Items', width: 36 },
        { header: 'Units', width: 6, align: 'right' as const },
        ...(costs ? [{ header: 'Price', width: 8, align: 'right' as const }] : []),
        { header: 'Booked in by', width: 11 },
      ],
      rows: items.map((i) => [
        when(i.createdAt),
        i.reference,
        ...(allShops ? [i.shopName] : []),
        [i.supplierName, i.supplierRef].filter(Boolean).join(' · ') || '—',
        i.lines
          .map((l) => {
            const option = l.variantLabel ? ` (${l.variantLabel})` : '';
            const cost = l.unitCost !== null ? ` @ ${formatPence(l.unitCost)}` : '';
            return `${l.qty} × ${l.name}${option}${cost}`;
          })
          .join('\n') + (i.notes ? `\nNote: ${i.notes}` : ''),
        String(i.unitCount),
        ...(costs ? [i.totalCost !== null ? formatPence(i.totalCost) : '—'] : []),
        i.staffName,
      ]),
      footnote: capNote(items.length, total),
    });
  },
);

/* ---- Log B: the change log ---------------------------------------------- */

const TYPE_LABEL: Record<Exclude<ChangeFilter, null>, string> = {
  stock: 'Stock changes',
  field: 'Price and detail changes',
  product: 'Added, retired and restored',
};

router.get('/change-log', requireStaff, requirePermission('reports.view'), async (req, res) => {
  const paging = pagingSchema.parse(req.query);
  const { items, total } = await listChanges(
    req,
    logFilters(req, readShop(req)),
    changeFilter(req),
    paging,
  );
  return res.json(page(items, total, paging.limit, paging.offset));
});

router.get('/change-log/pdf', requireStaff, requirePermission('reports.view'), async (req, res) => {
  const f = logFilters(req, readShop(req));
  const type = changeFilter(req);
  const { items, total } = await listChanges(req, f, type, { limit: EXPORT_CAP, offset: 0 });
  const head = await reportHeader(f, total, type ? [`Showing: ${TYPE_LABEL[type]}`] : []);
  const allShops = !f.shopId;

  sendLogReport(res, {
    filename: `inventory-log-${head.shopSlug}-${fileDates(f)}.pdf`,
    shopName: head.brand,
    title: 'Inventory change log',
    meta: head.meta,
    columns: [
      { header: 'When', width: 11 },
      ...(allShops ? [{ header: 'Shop', width: 9 }] : []),
      { header: 'Product', width: 22 },
      { header: 'Change', width: 10 },
      { header: 'Before', width: 12 },
      { header: 'After', width: 12 },
      { header: 'Why', width: 16 },
      { header: 'By', width: 10 },
    ],
    rows: items.map((c) => [
      when(c.createdAt),
      ...(allShops ? [c.shopName] : []),
      c.variantLabel ? `${c.productName} (${c.variantLabel})` : c.productName,
      c.what,
      truncate(c.before),
      truncate(c.after),
      [c.cause, c.note].filter(Boolean).join(' — '),
      c.actorName ?? 'System',
    ]),
    footnote: capNote(items.length, total),
  });
});

function truncate(value: string | null): string {
  if (value === null) return '';
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}
