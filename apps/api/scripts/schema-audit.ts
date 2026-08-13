/**
 * Fonology — frontend/API schema reconciliation audit.
 * ====================================================
 * The frontend Zod schemas in apps/web/src/lib/data/types were written
 * against the MOCK adapter's shapes. The http adapter boundary-parses every
 * response with those same schemas, so any shape the real API returns that
 * the schema doesn't expect is a screen that works in mock mode and breaks
 * in http mode. Two of these have already been found the hard way
 * (/admin/cash's staffName, /admin/staff's "employee" role).
 *
 * This script finds the rest by CALLING each endpoint and parsing the real
 * response with the real frontend schema — not by reading route code.
 *
 * For each endpoint it reports:
 *   HARD   — schema.parse() throws. Query retries forever, screen hangs.
 *   SILENT — parses, but the API sends keys the schema strips (data
 *            silently vanishes) or the schema expects keys the API never
 *            sends (renders blank/undefined).
 *   EMPTY  — endpoint returned no rows, so the item shape is unproven.
 *   OK     — parsed, no key drift.
 *
 * Read-only: every call is a GET plus two non-mutating POSTs (staff signin,
 * delivery quote). Nothing is created, updated or deleted.
 *
 * Run:  npx tsx scripts/schema-audit.ts        (API dev server must be up)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { type z } from 'zod';
import {
  productSchema,
  categorySchema,
  orderSchema,
  deliveryQuoteSchema,
  todaySummarySchema,
  todayReportSchema,
  cashEntrySchema,
  dayCloseSchema,
  shopDaySchema,
  refundSchema,
  deviceSchema,
  repairTypeSchema,
  partTierSchema,
  repairQuoteSchema,
  bookingSchema,
  adminProductSchema,
  promotionSchema,
  staffSchema,
  shopSettingsSchema,
  analyticsSummarySchema,
  transactionSchema,
  authUserSchema,
  sellRequestSchema,
  sellRequestPageSchema,
  tradeInPayoutPageSchema,
  printAgentSchema,
  printJobSchema,
} from '../../web/src/lib/data/types/index.js';

// Same source of local config as the server itself (src/config.ts): populate
// process.env from apps/api/.env.local so the audit credentials below can live
// in the gitignored env file rather than in this script.
loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.local') });

const API = process.env.E2E_API_BASE ?? 'http://127.0.0.1:4000';

/**
 * Audit credentials come from the environment, never from this file.
 *
 * They used to be hardcoded here. Dev-only on a dev project, so nothing was
 * exposed — but credentials-in-git is the same habit that once put a
 * service-role key in a web env file, and the fix is cheap.
 *
 * Deliberately no fallback: a default would mean this script could appear to
 * run while silently auditing as the wrong user (or skipping the staff half
 * of the audit entirely), which is worse than not running. See
 * apps/api/.env.example for the variable names.
 */
const OWNER_EMAIL = process.env.AUDIT_STAFF_EMAIL;
const OWNER_PASSWORD = process.env.AUDIT_STAFF_PASSWORD;

if (!OWNER_EMAIL || !OWNER_PASSWORD) {
  console.error(
    [
      'Schema audit needs staff credentials for the dev project.',
      '',
      'Set both of these before running:',
      '  AUDIT_STAFF_EMAIL     — a staff account on the DEV project',
      '  AUDIT_STAFF_PASSWORD  — its password',
      '',
      'Put them in apps/api/.env.local (gitignored) or export them for the run:',
      '  AUDIT_STAFF_EMAIL=... AUDIT_STAFF_PASSWORD=... npx tsx scripts/schema-audit.ts',
      '',
      'See apps/api/.env.example. Never commit the values.',
    ].join('\n'),
  );
  process.exit(1);
}

/* ---- cookie jar (same approach as e2e-test.ts) ---------------------------- */

class Client {
  private cookies = new Map<string, string>();

  private applySetCookie(res: Response) {
    const raw =
      (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async request(method: string, path: string, body?: unknown) {
    const cookieHeader = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.applySetCookie(res);
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed as any };
  }

  get(path: string) {
    return this.request('GET', path);
  }
  post(path: string, body?: unknown) {
    return this.request('POST', path, body);
  }
}

/* ---- zod introspection ---------------------------------------------------- */

/** Peel optional/nullable/default/effects/lazy wrappers off to the core type. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s: any = schema;
  for (let i = 0; i < 20; i++) {
    const name = s?._def?.typeName;
    if (
      name === 'ZodOptional' ||
      name === 'ZodNullable' ||
      name === 'ZodDefault' ||
      name === 'ZodReadonly' ||
      name === 'ZodBranded' ||
      name === 'ZodCatch'
    ) {
      s = s._def.innerType;
    } else if (name === 'ZodEffects') {
      s = s._def.schema;
    } else if (name === 'ZodLazy') {
      s = s._def.getter();
    } else if (name === 'ZodPipeline') {
      s = s._def.out;
    } else {
      break;
    }
  }
  return s;
}

type Drift = { path: string; kind: 'extra' | 'missing'; key: string };

/**
 * Walk a real API value alongside the schema that's meant to describe it and
 * collect key drift:
 *   extra   — the API sent it, the schema has no field for it (zod strips it,
 *             so the screen never sees the data)
 *   missing — the schema declares it optional and the API never sends it
 *             (renders as undefined; usually means the field is mock-only)
 * Required-but-absent keys are caught by parse() itself, so they're not here.
 */
function keyDrift(value: unknown, schema: z.ZodTypeAny, path = '', out: Drift[] = []): Drift[] {
  const s: any = unwrap(schema);
  const name = s?._def?.typeName;

  if (value === null || value === undefined) return out;

  if (name === 'ZodArray') {
    if (!Array.isArray(value)) return out;
    // Every element, not a sample: a key that only appears on some rows (a
    // populated nullable, an optional block) is exactly the drift that hides
    // from a spot-check. Findings are de-duplicated by the caller.
    for (const item of value) keyDrift(item, s._def.type, `${path}[]`, out);
    return out;
  }

  if (name === 'ZodObject') {
    if (typeof value !== 'object' || Array.isArray(value)) return out;
    const shape = s.shape as Record<string, z.ZodTypeAny>;
    const valueKeys = Object.keys(value as object);
    const shapeKeys = Object.keys(shape);

    for (const k of valueKeys) {
      if (!shapeKeys.includes(k)) out.push({ path, kind: 'extra', key: k });
    }
    for (const k of shapeKeys) {
      if (!valueKeys.includes(k)) out.push({ path, kind: 'missing', key: k });
    }
    for (const k of shapeKeys) {
      if (valueKeys.includes(k)) {
        keyDrift((value as any)[k], shape[k], path ? `${path}.${k}` : k, out);
      }
    }
    return out;
  }

  if (name === 'ZodRecord') {
    if (typeof value !== 'object' || Array.isArray(value)) return out;
    for (const [k, v] of Object.entries(value as object)) {
      keyDrift(v, s._def.valueType, `${path}.${k}`, out);
    }
    return out;
  }

  return out;
}

/** How many objects the sample actually contained — an empty array proves nothing. */
function sampleSize(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return value === null || value === undefined ? 0 : 1;
}

/* ---- reporting ------------------------------------------------------------ */

type Verdict = 'OK' | 'HARD' | 'SILENT' | 'EMPTY' | 'SKIP';
type Row = {
  screen: string;
  method: string;
  endpoint: string;
  schema: string;
  verdict: Verdict;
  detail: string[];
};

const rows: Row[] = [];

function record(
  screen: string,
  method: string,
  endpoint: string,
  schemaName: string,
  schema: z.ZodTypeAny,
  status: number,
  body: unknown,
  note?: string,
) {
  const detail: string[] = [];

  if (status >= 400) {
    rows.push({
      screen,
      method,
      endpoint,
      schema: schemaName,
      verdict: 'SKIP',
      detail: [`HTTP ${status}: ${JSON.stringify(body)?.slice(0, 200)}`],
    });
    return;
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    for (const issue of result.error.issues.slice(0, 12)) {
      detail.push(`${issue.path.join('.') || '(root)'}: ${issue.message} [${issue.code}]`);
    }
    if (result.error.issues.length > 12) {
      detail.push(`… +${result.error.issues.length - 12} more issues`);
    }
    rows.push({ screen, method, endpoint, schema: schemaName, verdict: 'HARD', detail });
    return;
  }

  const n = sampleSize(body);
  if (n === 0) {
    rows.push({
      screen,
      method,
      endpoint,
      schema: schemaName,
      verdict: 'EMPTY',
      detail: [note ?? 'no rows returned — item shape unproven'],
    });
    return;
  }

  const drift = keyDrift(body, schema);
  // De-duplicate: the same drift repeats across every array element.
  const seen = new Set<string>();
  for (const d of drift) {
    const sig = `${d.kind}|${d.path}|${d.key}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    detail.push(
      d.kind === 'extra'
        ? `API sends "${d.path ? `${d.path}.` : ''}${d.key}" — schema has no field, value is stripped`
        : `schema declares optional "${d.path ? `${d.path}.` : ''}${d.key}" — API never sends it`,
    );
  }

  rows.push({
    screen,
    method,
    endpoint,
    schema: schemaName,
    verdict: detail.length ? 'SILENT' : 'OK',
    detail: detail.length ? detail : [`parsed ${n} row(s) cleanly`],
  });
}

/* ---- the audit ------------------------------------------------------------ */

async function main() {
  const pub = new Client();
  const staff = new Client();

  console.log(`Auditing ${API}\n`);

  // --- public / storefront (no auth) ---
  const products = await pub.get('/products');
  record(
    'Shop catalogue',
    'GET',
    '/products',
    'productSchema[]',
    productSchema.array(),
    products.status,
    products.body,
  );

  const slug = Array.isArray(products.body) ? products.body[0]?.slug : undefined;
  if (slug) {
    const one = await pub.get(`/products/${encodeURIComponent(slug)}`);
    record(
      'Product detail',
      'GET',
      '/products/:slug',
      'productSchema',
      productSchema,
      one.status,
      one.body,
    );
  }

  const cats = await pub.get('/categories');
  record(
    'Shop nav',
    'GET',
    '/categories',
    'categorySchema[]',
    categorySchema.array(),
    cats.status,
    cats.body,
  );

  const devices = await pub.get('/repair/devices');
  record(
    'Repair booking',
    'GET',
    '/repair/devices',
    'deviceSchema[]',
    deviceSchema.array(),
    devices.status,
    devices.body,
  );

  const rtypes = await pub.get('/repair/types');
  record(
    'Repair booking',
    'GET',
    '/repair/types',
    'repairTypeSchema[]',
    repairTypeSchema.array(),
    rtypes.status,
    rtypes.body,
  );

  const tiers = await pub.get('/repair/tiers');
  record(
    'Repair booking',
    'GET',
    '/repair/tiers',
    'partTierSchema[]',
    partTierSchema.array(),
    tiers.status,
    tiers.body,
  );

  // A real quote needs a real device+repair+tier triple.
  const deviceId = Array.isArray(devices.body) ? devices.body[0]?.id : undefined;
  const repairId = Array.isArray(rtypes.body) ? rtypes.body[0]?.id : undefined;
  const tierId = Array.isArray(tiers.body) ? tiers.body[0]?.id : undefined;
  if (deviceId && repairId && tierId) {
    const q = await pub.get(
      `/repair/quote?deviceId=${encodeURIComponent(deviceId)}&repairId=${encodeURIComponent(repairId)}&tierId=${encodeURIComponent(tierId)}`,
    );
    record(
      'Repair quote',
      'GET',
      '/repair/quote',
      'repairQuoteSchema',
      repairQuoteSchema,
      q.status,
      q.body,
    );
  }

  // Non-mutating: prices a basket, writes nothing.
  const p0 = Array.isArray(products.body) ? products.body[0] : undefined;
  const dq = await pub.post('/orders/delivery-quote', {
    lines: p0
      ? [
          {
            productId: p0.id,
            name: p0.name,
            sub: p0.sub ?? '',
            slug: p0.slug,
            kind: p0.kind,
            unitPrice: p0.price,
            quantity: 1,
          },
        ]
      : [],
    delivery: 'standard',
    postcode: 'M1 1AE',
  });
  record(
    'Checkout',
    'POST',
    '/orders/delivery-quote',
    'deliveryQuoteSchema',
    deliveryQuoteSchema,
    dq.status,
    dq.body,
  );

  // --- staff surface ---
  const signin = await staff.post('/staff/signin', {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  record(
    'Staff sign-in',
    'POST',
    '/staff/signin',
    'authUserSchema',
    authUserSchema,
    signin.status,
    signin.body,
  );
  if (signin.status >= 400) {
    console.error('Staff sign-in failed — the authenticated half of the audit cannot run.');
    print();
    process.exit(1);
  }

  const session = await staff.get('/auth/session');
  record(
    'Every admin screen',
    'GET',
    '/auth/session',
    'authUserSchema',
    authUserSchema,
    session.status,
    session.body,
  );

  const orders = await staff.get('/orders');
  record(
    '/admin/orders',
    'GET',
    '/orders',
    'orderSchema[]',
    orderSchema.array(),
    orders.status,
    orders.body,
  );

  const bookings = await staff.get('/repair/bookings');
  record(
    '/admin/bookings',
    'GET',
    '/repair/bookings',
    'bookingSchema[]',
    bookingSchema.array(),
    bookings.status,
    bookings.body,
  );

  const adminProducts = await staff.get('/admin/products');
  record(
    '/admin/products',
    'GET',
    '/admin/products',
    'adminProductSchema[]',
    adminProductSchema.array(),
    adminProducts.status,
    adminProducts.body,
  );

  // Barcode lookup — the scanner's one endpoint. Audited on a REAL barcode
  // taken from the catalogue above, because the interesting drift here is in
  // the hit case (does it really return a full admin product?). The miss case
  // is checked separately below: it answers 200 with a bare `null`, which the
  // frontend schema has to allow via .nullable() — get that wrong and every
  // unknown scan throws instead of telling staff the code is unknown.
  const productsForBarcode = Array.isArray(adminProducts.body)
    ? (adminProducts.body as { barcode?: string | null }[])
    : [];
  const knownBarcode = productsForBarcode.find((p) => p.barcode)?.barcode;

  if (knownBarcode) {
    const byBarcode = await staff.get(
      `/admin/products/barcode/${encodeURIComponent(knownBarcode)}`,
    );
    record(
      '/pos till + /admin/inventory (scanner)',
      'GET',
      '/admin/products/barcode/:code',
      'adminProductSchema.nullable()',
      adminProductSchema.nullable(),
      byBarcode.status,
      byBarcode.body,
    );
  }

  const missBarcode = await staff.get('/admin/products/barcode/__no_such_barcode__');
  record(
    '/pos till + /admin/inventory (scanner, unknown code)',
    'GET',
    '/admin/products/barcode/:code',
    'adminProductSchema.nullable()',
    adminProductSchema.nullable(),
    missBarcode.status,
    missBarcode.body,
    missBarcode.body === null ? 'miss returns null, as the adapter expects' : undefined,
  );

  const promos = await staff.get('/admin/promotions');
  record(
    '/admin/promotions',
    'GET',
    '/admin/promotions',
    'promotionSchema[]',
    promotionSchema.array(),
    promos.status,
    promos.body,
  );

  const staffList = await staff.get('/admin/staff');
  record(
    '/admin/staff',
    'GET',
    '/admin/staff',
    'staffSchema[]',
    staffSchema.array(),
    staffList.status,
    staffList.body,
  );

  const settings = await staff.get('/admin/settings');
  record(
    '/admin/settings',
    'GET',
    '/admin/settings',
    'shopSettingsSchema',
    shopSettingsSchema,
    settings.status,
    settings.body,
  );

  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);

  const analytics = await staff.get(`/reports/analytics?from=${from}&to=${today}`);
  record(
    '/admin/analytics',
    'GET',
    '/reports/analytics',
    'analyticsSummarySchema',
    analyticsSummarySchema,
    analytics.status,
    analytics.body,
  );

  const txns = await staff.get(`/reports/transactions?from=${from}&to=${today}`);
  record(
    '/admin/transactions',
    'GET',
    '/reports/transactions',
    'transactionSchema[]',
    transactionSchema.array(),
    txns.status,
    txns.body,
  );

  const cash = await staff.get('/pos/cash');
  record(
    '/admin/cash',
    'GET',
    '/pos/cash',
    'cashEntrySchema[]',
    cashEntrySchema.array(),
    cash.status,
    cash.body,
  );

  const shopDay = await staff.get('/pos/shop-day');
  record(
    '/admin/cash + day-close',
    'GET',
    '/pos/shop-day',
    'shopDaySchema',
    shopDaySchema,
    shopDay.status,
    shopDay.body,
  );

  const closes = await staff.get('/pos/day-close');
  record(
    '/admin/day-close',
    'GET',
    '/pos/day-close',
    'dayCloseSchema[]',
    dayCloseSchema.array(),
    closes.status,
    closes.body,
  );

  const refunds = await staff.get('/pos/refunds');
  record(
    '/admin/refunds',
    'GET',
    '/pos/refunds',
    'refundSchema[]',
    refundSchema.array(),
    refunds.status,
    refunds.body,
  );

  const posToday = await staff.get('/pos/today');
  record(
    '/pos till',
    'GET',
    '/pos/today',
    'todaySummarySchema',
    todaySummarySchema,
    posToday.status,
    posToday.body,
  );

  // The print screen. Worth auditing specifically because several fields on
  // these two responses exist in NO TABLE — `health`, `shopOpen`,
  // `secondsSinceSeen` and `requestedByName` are computed in the route — so
  // they are exactly the kind of shape a schema written from the schema
  // diagram would get wrong.
  const printAgents = await staff.get('/print/agents');
  record(
    '/admin/printing',
    'GET',
    '/print/agents',
    'printAgentSchema[]',
    printAgentSchema.array(),
    printAgents.status,
    printAgents.body,
  );

  const printQueue = await staff.get('/print/queue');
  record(
    '/admin/printing',
    'GET',
    '/print/queue',
    'printJobSchema[]',
    printJobSchema.array(),
    printQueue.status,
    printQueue.body,
  );

  const sellQueue = await staff.get('/sell/requests?limit=25');
  record(
    '/admin/trade-ins',
    'GET',
    '/sell/requests',
    'sellRequestPageSchema',
    sellRequestPageSchema,
    sellQueue.status,
    sellQueue.body,
  );

  const firstRequest = sellQueue.body?.items?.[0]?.id;
  if (firstRequest) {
    const one = await staff.get(`/sell/requests/${firstRequest}`);
    record(
      '/admin/trade-ins/[id]',
      'GET',
      '/sell/requests/:id',
      'sellRequestSchema',
      sellRequestSchema,
      one.status,
      one.body,
    );
  }

  const payouts = await staff.get('/sell/payouts?limit=25');
  record(
    '/admin/trade-ins/payouts',
    'GET',
    '/sell/payouts',
    'tradeInPayoutPageSchema',
    tradeInPayoutPageSchema,
    payouts.status,
    payouts.body,
  );

  const posReport = await staff.get('/pos/today/report');
  record(
    '/pos end-of-day',
    'GET',
    '/pos/today/report',
    'todayReportSchema',
    todayReportSchema,
    posReport.status,
    posReport.body,
  );

  print();
}

function print() {
  const order: Record<Verdict, number> = { HARD: 0, SILENT: 1, EMPTY: 2, SKIP: 3, OK: 4 };
  rows.sort((a, b) => order[a.verdict] - order[b.verdict]);

  console.log('\n================ SCHEMA AUDIT ================\n');
  for (const r of rows) {
    console.log(`[${r.verdict}] ${r.method} ${r.endpoint}  →  ${r.schema}`);
    console.log(`        screen: ${r.screen}`);
    for (const d of r.detail) console.log(`        - ${d}`);
    console.log('');
  }

  const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
  console.log('---------------------------------------------');
  console.log(
    `HARD ${count('HARD')}   SILENT ${count('SILENT')}   EMPTY ${count('EMPTY')}   SKIP ${count('SKIP')}   OK ${count('OK')}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
