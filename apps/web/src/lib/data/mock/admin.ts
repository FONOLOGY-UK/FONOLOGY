import type {
  AdminCategory,
  AdminProduct,
  AdminReview,
  CashEntry,
  DayClose,
  Job,
  JobPart,
  JobPaymentRecord,
  LabelTemplate,
  Promotion,
  Refund,
  ShopSettings,
  Staff,
  StockMeta,
  TradeInPayout,
  Transaction,
  Tender,
} from '../types';
import { pounds } from '../types';
import { MOCK_PRODUCTS, MOCK_CATEGORIES } from './products';
import { MOCK_REVIEWS } from './reviews';

/**
 * Admin fixtures (item 7). A year of settled transactions is GENERATED with a
 * seeded PRNG so every reload shows the same believable business — weekday
 * rhythm, Saturday peak, Sunday closed, lunchtime footfall, a slow growth
 * trend. Everything is in-memory and resets on reload: a mock, not a database.
 */

/* ---- deterministic PRNG (LCG) so the "business history" is stable -------- */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rand = seeded(20260719);

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error('pick() from empty array');
  return item;
}

/* ---- inventory meta (admin-side truth per product) ------------------------ */

const FALLBACK_META: StockMeta = {
  costPrice: 0,
  stockQty: 0,
  supplier: null,
  localBuying: false,
  buyInForm: null,
  barcode: null,
  lowStockAlert: true,
  lowStockThreshold: 5,
};

/** Keyed by product id. Quantities agree with the storefront stockStatus:
 *  out-of-stock/restocking products sit at 0. Low-stock alerting is PER
 *  PRODUCT — halo-stand (3 ≤ 4) and privacy-14 (4 ≤ 6) are deliberately
 *  flagged, pulse-anc carries a wider threshold because it moves fast, and
 *  vapes/plates have the alert switched off entirely. */
export const MOCK_STOCK_META: Record<string, StockMeta> = {
  'aegis-15': {
    costPrice: pounds(9.5),
    stockQty: 26,
    supplier: 'Northline Trade Ltd',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340015',
    lowStockAlert: true,
    lowStockThreshold: 5,
  },
  'volt-65': {
    costPrice: pounds(15),
    stockQty: 18,
    supplier: 'Volta Distribution',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340022',
    lowStockAlert: true,
    lowStockThreshold: 5,
  },
  'braid-c2': {
    costPrice: pounds(3.2),
    stockQty: 41,
    supplier: 'Northline Trade Ltd',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340039',
    lowStockAlert: true,
    lowStockThreshold: 5,
  },
  'glasspro-2': {
    costPrice: pounds(3.8),
    stockQty: 33,
    supplier: 'ShieldWorks UK',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340046',
    lowStockAlert: true,
    lowStockThreshold: 5,
  },
  'pulse-anc': {
    costPrice: pounds(22),
    stockQty: 9,
    supplier: 'Volta Distribution',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340053',
    lowStockAlert: true,
    lowStockThreshold: 10,
  },
  'arc-10k': {
    costPrice: pounds(17.5),
    stockQty: 14,
    supplier: 'Volta Distribution',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340060',
    lowStockAlert: true,
    lowStockThreshold: 5,
  },
  'halo-stand': {
    costPrice: pounds(3.4),
    stockQty: 3,
    supplier: 'Northline Trade Ltd',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340077',
    lowStockAlert: true,
    lowStockThreshold: 4,
  },
  'crystal-24': {
    costPrice: pounds(6.9),
    stockQty: 0,
    supplier: 'ShieldWorks UK',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340084',
    lowStockAlert: true,
    lowStockThreshold: 5,
  },
  'grip-vent': {
    costPrice: pounds(5.8),
    stockQty: 0,
    supplier: 'Northline Trade Ltd',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340091',
    lowStockAlert: true,
    lowStockThreshold: 5,
  },
  'pocket-kit': {
    costPrice: pounds(4.1),
    stockQty: 22,
    supplier: 'iParts Direct',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340107',
    lowStockAlert: true,
    lowStockThreshold: 5,
  },
  'watch-duo': {
    costPrice: pounds(9.8),
    stockQty: 11,
    supplier: 'Volta Distribution',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340114',
    lowStockAlert: true,
    lowStockThreshold: 5,
  },
  'privacy-14': {
    costPrice: pounds(4.6),
    stockQty: 4,
    supplier: 'ShieldWorks UK',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340121',
    lowStockAlert: true,
    lowStockThreshold: 6,
  },
  'vape-berry-ice': {
    costPrice: pounds(2.1),
    stockQty: 48,
    supplier: 'CloudTrade Vapes',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340138',
    lowStockAlert: false,
    lowStockThreshold: 5,
  },
  'vape-mango-pod': {
    costPrice: pounds(6.5),
    stockQty: 17,
    supplier: 'CloudTrade Vapes',
    localBuying: false,
    buyInForm: null,
    barcode: '5060412340145',
    lowStockAlert: true,
    lowStockThreshold: 5,
  },
  'plate-4d-standard': {
    costPrice: pounds(12),
    stockQty: 30,
    supplier: 'PlateForm UK',
    localBuying: false,
    buyInForm: null,
    barcode: null,
    lowStockAlert: false,
    lowStockThreshold: 5,
  },
  'plate-show-3d': {
    costPrice: pounds(9),
    stockQty: 25,
    supplier: 'PlateForm UK',
    localBuying: false,
    buyInForm: null,
    barcode: null,
    lowStockAlert: false,
    lowStockThreshold: 5,
  },
};

export function stockMetaFor(productId: string): StockMeta {
  return MOCK_STOCK_META[productId] ?? FALLBACK_META;
}

/* ---- categories (FEATURE-05) ----------------------------------------------
 * Admin's-eye view of the same 7 categories MOCK_CATEGORIES already lists
 * for the storefront filter (minus its synthetic 'all' entry) — one real row
 * per slug, none of them a subcategory, id/slug/label kept in step with the
 * DB's own migration 0045 seed by construction rather than by hand.
 */
export const MOCK_ADMIN_CATEGORIES: AdminCategory[] = MOCK_CATEGORIES.filter(
  (c) => c.id !== 'all',
).map((c, i) => ({
  id: `cat-${c.id}`,
  label: c.label,
  slug: c.id,
  parentId: null,
  createdAt: new Date(2026, 0, 1 + i).toISOString(),
}));

const ADMIN_CATEGORY_ID_BY_SLUG = new Map(MOCK_ADMIN_CATEGORIES.map((c) => [c.slug, c.id]));

/* ---- staff ---------------------------------------------------------------- */

export const MOCK_STAFF: Staff[] = [
  {
    id: 'stf-1',
    name: 'Tanoli Hussain',
    role: 'owner',
    phone: '07700 900101',
    email: 'tanoli@fonology.co.uk',
    active: true,
    startedAt: '2023-04-01',
  },
  {
    id: 'stf-2',
    name: 'Marcus Bell',
    role: 'employee',
    phone: '07700 900102',
    email: 'marcus@fonology.co.uk',
    active: true,
    startedAt: '2023-09-11',
  },
  {
    id: 'stf-3',
    name: 'Sana Iqbal',
    role: 'employee',
    phone: '07700 900103',
    email: 'sana@fonology.co.uk',
    active: true,
    startedAt: '2024-06-03',
  },
  {
    id: 'stf-4',
    name: 'Dev Patel',
    role: 'employee',
    phone: '07700 900104',
    email: 'dev@fonology.co.uk',
    active: false,
    startedAt: '2022-11-21',
  },
];

/* ---- settings ------------------------------------------------------------- */

export const DEFAULT_SETTINGS: ShopSettings = {
  returnWindowDays: 30,
  idleLockMinutes: 5,
  floatTarget: pounds(150),
};

/* ---- a year of settled transactions --------------------------------------- */

const REPAIR_LINES = [
  { desc: 'Screen replacement — iPhone 14', price: 121, cost: 46 },
  { desc: 'Screen replacement — Galaxy S23', price: 132, cost: 52 },
  { desc: 'Battery service — iPhone 13', price: 64, cost: 19 },
  { desc: 'Battery service — Pixel 7', price: 69, cost: 22 },
  { desc: 'Charging port repair', price: 59, cost: 14 },
  { desc: 'Back glass replacement', price: 89, cost: 31 },
  { desc: 'Camera module — iPhone 15', price: 109, cost: 44 },
  { desc: 'Water damage treatment', price: 75, cost: 12 },
  { desc: 'Data recovery', price: 95, cost: 8 },
] as const;

/** Everything sells at the counter — vapes and plates included (in-store). */
const SELLABLE = MOCK_PRODUCTS;

const IN_STORE_TENDERS: Tender[] = ['cash', 'cash', 'pos1', 'pos1', 'pos1', 'pos2', 'pos2'];
const ONLINE_TENDERS: Tender[] = ['stripe', 'stripe', 'stripe', 'transfer'];

/** Trading-hour weighting: quiet open, lunchtime peak, after-work bump. */
const HOUR_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [9, 4],
  [10, 7],
  [11, 9],
  [12, 13],
  [13, 14],
  [14, 10],
  [15, 8],
  [16, 11],
  [17, 9],
];

function weightedHour(): number {
  const total = HOUR_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let roll = rand() * total;
  for (const [hour, weight] of HOUR_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return hour;
  }
  return 13;
}

function generateTransactions(): Transaction[] {
  const rows: Transaction[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let seq = 4000;

  for (let back = 400; back >= 0; back -= 1) {
    const day = new Date(today);
    day.setDate(day.getDate() - back);
    const dow = day.getDay(); // 0 = Sunday
    if (dow === 0) continue; // Sunday: closed (we sleep)

    // Slow growth + gentle seasonality (winter gifting bump).
    const growth = 1 + (400 - back) * 0.0009;
    const month = day.getMonth();
    const seasonal = month === 11 ? 1.35 : month === 0 ? 0.85 : 1;
    const saturday = dow === 6 ? 1.5 : 1;
    const buzz = 0.75 + rand() * 0.5;
    const volume = growth * seasonal * saturday * buzz;

    const shopSales = Math.round(4 * volume + rand() * 3);
    const repairSales = Math.round(2 * volume + rand() * 2);
    const tradeIns = rand() < 0.18 ? 1 : 0;

    const stamp = (hour: number): string => {
      const at = new Date(day);
      at.setHours(hour, Math.floor(rand() * 60), 0, 0);
      return at.toISOString();
    };

    for (let i = 0; i < shopSales; i += 1) {
      const product = pick(SELLABLE);
      const meta = stockMetaFor(product.id);
      const qty = rand() < 0.15 ? 2 : 1;
      const online = product.kind !== 'vape' && rand() < 0.3;
      seq += 1;
      rows.push({
        id: `txn-${seq}`,
        at: stamp(weightedHour()),
        stream: 'shop',
        reference: `FNL-${seq}`,
        description: qty > 1 ? `${product.name} ×${qty}` : product.name,
        amount: product.price * qty,
        cost: meta.costPrice * qty,
        tender: online ? pick(ONLINE_TENDERS) : pick(IN_STORE_TENDERS),
        category: product.category,
      });
    }

    for (let i = 0; i < repairSales; i += 1) {
      const line = pick(REPAIR_LINES);
      seq += 1;
      rows.push({
        id: `txn-${seq}`,
        at: stamp(weightedHour()),
        stream: 'repair',
        reference: `FNL-${seq}`,
        description: line.desc,
        amount: pounds(line.price),
        cost: pounds(line.cost),
        tender: pick(IN_STORE_TENDERS),
        category: null,
      });
    }

    for (let i = 0; i < tradeIns; i += 1) {
      seq += 1;
      rows.push({
        id: `txn-${seq}`,
        at: stamp(weightedHour()),
        stream: 'trade-in',
        reference: `FNL-${seq}`,
        description: 'Trade-in payout',
        amount: -pounds(40 + Math.round(rand() * 180)),
        cost: 0,
        tender: rand() < 0.6 ? 'cash' : 'transfer',
        category: null,
      });
    }
  }

  return rows;
}

/* ---- bench jobs ------------------------------------------------------------ */

function daysAgo(days: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const seededJobs: Job[] = [
  {
    id: 'job-101',
    reference: 'FNL-5101',
    customerName: 'Leah Whitmore',
    phone: '07700 900411',
    email: 'leah.w@example.co.uk',
    deviceDescription: 'iPhone 14 Pro',
    problemDescription: 'Cracked screen, touch still works',
    notes: 'Wants original part.',
    quotedPrice: pounds(149),
    paymentStatus: 'deposit_paid',
    status: 'new',
    source: 'walk_in',
    createdAt: daysAgo(0, 9, 40),
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(0, 9, 40),
  },
  {
    id: 'job-102',
    reference: 'FNL-5102',
    customerName: 'Danny Okafor',
    phone: '07700 900412',
    deviceDescription: 'Galaxy S22',
    problemDescription: 'Battery drains in 3 hours',
    quotedPrice: pounds(69),
    paymentStatus: 'unpaid',
    status: 'new',
    source: 'walk_in',
    createdAt: daysAgo(0, 10, 15),
    notes: null,
    email: null,
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(0, 10, 15),
  },
  {
    id: 'job-103',
    reference: 'FNL-5103',
    customerName: 'Chloe Adeyemi',
    phone: '07700 900321',
    email: 'chloe.a@example.co.uk',
    deviceDescription: 'iPhone 14',
    problemDescription: 'Front screen replacement (mail-in)',
    notes: 'Back glass is fine, just the front.',
    quotedPrice: pounds(121),
    paymentStatus: 'unpaid',
    status: 'in_progress',
    source: 'mail_in',
    createdAt: daysAgo(1, 8, 5),
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(0, 9, 0),
  },
  {
    id: 'job-104',
    reference: 'FNL-5104',
    customerName: 'Ryan Chen',
    phone: '07700 900413',
    deviceDescription: 'Pixel 8',
    problemDescription: 'Charging port loose',
    quotedPrice: pounds(59),
    paymentStatus: 'unpaid',
    status: 'in_progress',
    source: 'walk_in',
    createdAt: daysAgo(1, 11, 30),
    notes: null,
    email: null,
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(0, 10, 20),
  },
  {
    id: 'job-105',
    reference: 'FNL-5105',
    customerName: 'Amira Hassan',
    phone: '07700 900414',
    email: 'amira.h@example.co.uk',
    deviceDescription: 'iPad Air (5th gen)',
    problemDescription: 'Smashed digitiser',
    notes: 'Quoted after diagnosis.',
    quotedPrice: null,
    paymentStatus: 'unpaid',
    status: 'in_progress',
    source: 'walk_in',
    createdAt: daysAgo(2, 14, 0),
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(1, 16, 45),
  },
  {
    id: 'job-106',
    reference: 'FNL-5106',
    customerName: 'Josh Barker',
    phone: '07700 900415',
    deviceDescription: 'iPhone 12',
    problemDescription: 'Battery service',
    quotedPrice: pounds(59),
    paymentStatus: 'paid',
    status: 'done',
    source: 'walk_in',
    createdAt: daysAgo(2, 10, 10),
    notes: null,
    email: null,
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(0, 12, 0),
  },
  {
    id: 'job-107',
    reference: 'FNL-5107',
    customerName: 'Ade Kolawole',
    phone: '07700 900654',
    email: 'ade.k@example.co.uk',
    deviceDescription: 'Galaxy S23',
    problemDescription: 'Battery replacement (mail-in)',
    quotedPrice: pounds(64),
    paymentStatus: 'unpaid',
    status: 'done',
    source: 'mail_in',
    createdAt: daysAgo(3, 9, 20),
    notes: null,
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(1, 15, 30),
  },
  {
    id: 'job-108',
    reference: 'FNL-5108',
    customerName: 'Sophie Turner',
    phone: '07700 900416',
    deviceDescription: 'iPhone 15',
    problemDescription: 'Rear camera blurry',
    quotedPrice: pounds(109),
    paymentStatus: 'paid',
    status: 'done',
    source: 'walk_in',
    createdAt: daysAgo(3, 15, 45),
    notes: null,
    email: null,
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(1, 11, 15),
  },
  {
    id: 'job-109',
    reference: 'FNL-5109',
    customerName: 'Martin Reid',
    phone: '07700 900417',
    deviceDescription: 'OnePlus 11',
    problemDescription: 'Water damage — no power',
    notes: 'Dropped in sink. Warned data not guaranteed.',
    quotedPrice: null,
    paymentStatus: 'unpaid',
    status: 'collected',
    source: 'walk_in',
    createdAt: daysAgo(6, 12, 0),
    email: null,
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(2, 17, 10),
  },
  {
    id: 'job-110',
    reference: 'FNL-5110',
    customerName: 'Grace Lin',
    phone: '07700 900418',
    email: 'grace.l@example.co.uk',
    deviceDescription: 'iPhone 13 mini',
    problemDescription: 'Screen + battery combo',
    quotedPrice: pounds(139),
    paymentStatus: 'paid',
    status: 'collected',
    source: 'walk_in',
    createdAt: daysAgo(7, 10, 25),
    notes: null,
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(4, 13, 40),
  },
  {
    id: 'job-111',
    reference: 'FNL-5111',
    customerName: 'Tom Brennan',
    phone: '07700 900333',
    email: 'tom.brennan@example.co.uk',
    deviceDescription: 'MacBook Air M1',
    problemDescription: 'Keyboard — three dead keys',
    quotedPrice: pounds(145),
    paymentStatus: 'deposit_paid',
    status: 'collected',
    source: 'online',
    createdAt: daysAgo(9, 14, 30),
    notes: null,
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(5, 16, 0),
  },
  {
    id: 'job-112',
    reference: 'FNL-5112',
    customerName: 'Nadia Begum',
    phone: '07700 900419',
    deviceDescription: 'Galaxy A54',
    problemDescription: 'Cracked back glass',
    quotedPrice: pounds(74),
    paymentStatus: 'unpaid',
    status: 'new',
    source: 'walk_in',
    createdAt: daysAgo(0, 11, 55),
    notes: null,
    email: null,
    depositAmount: null,
    revisedQuote: null,
    revisedQuoteApprovedBy: null,
    revisedQuoteApprovedAt: null,
    returnTrackingNumber: null,
    cancellationReason: null,
    deviceReturned: null,
    assignedStaffId: null,
    bookingId: null,
    orderId: null,
    updatedAt: daysAgo(0, 11, 55),
  },
];

/* ---- promotions (in-store only) ------------------------------------------- */

const seededPromotions: Promotion[] = [
  {
    id: 'promo-1',
    name: 'Tempered glass multi-buy',
    productIds: ['glasspro-2', 'privacy-14'],
    tiers: [
      { minQty: 2, unitPrice: pounds(12) },
      { minQty: 4, unitPrice: pounds(10) },
    ],
    active: true,
    createdAt: daysAgo(40, 10),
  },
  {
    id: 'promo-2',
    name: 'Cable bundle',
    productIds: ['braid-c2'],
    tiers: [{ minQty: 3, unitPrice: pounds(9) }],
    active: true,
    createdAt: daysAgo(21, 12),
  },
  {
    id: 'promo-3',
    name: 'Case + glass counter deal',
    productIds: ['aegis-15'],
    tiers: [{ minQty: 2, unitPrice: pounds(20) }],
    active: false,
    createdAt: daysAgo(90, 9),
  },
];

/* ---- label templates ------------------------------------------------------- */

const seededLabels: LabelTemplate[] = [
  {
    id: 'lbl-1',
    name: 'Shelf price label',
    lines: [
      { text: 'Aegis Mag Case', size: 'md', bold: true },
      { text: 'iPhone 15 / 15 Pro', size: 'sm', bold: false },
      { text: '£24', size: 'lg', bold: true },
    ],
    barcode: '5060412340015',
    updatedAt: daysAgo(12, 15),
  },
  {
    id: 'lbl-2',
    name: 'Tested pre-owned tag',
    lines: [
      { text: 'TESTED PRE-OWNED', size: 'sm', bold: true },
      { text: '90-day warranty', size: 'sm', bold: false },
    ],
    barcode: null,
    updatedAt: daysAgo(30, 11),
  },
];

/* ---- cash drawer ------------------------------------------------------------ */

function isoDay(back: number): string {
  const d = new Date();
  d.setDate(d.getDate() - back);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Floats for recent trading days — but NOT today, so the morning float
 *  prompt fires on first visit (per the brief). */
const seededCash: CashEntry[] = [
  {
    id: 'cash-1',
    date: isoDay(1),
    at: daysAgo(1, 9, 2),
    kind: 'float-open',
    amount: pounds(150),
    note: 'Opening float',
    staffName: 'Sana Iqbal',
  },
  {
    id: 'cash-2',
    date: isoDay(1),
    at: daysAgo(1, 13, 20),
    kind: 'petty-out',
    amount: pounds(6.5),
    note: 'Cleaning supplies',
    staffName: 'Sana Iqbal',
  },
  {
    id: 'cash-3',
    date: isoDay(2),
    at: daysAgo(2, 9, 5),
    kind: 'float-open',
    amount: pounds(150),
    note: 'Opening float',
    staffName: 'Marcus Bell',
  },
  {
    id: 'cash-4',
    date: isoDay(2),
    at: daysAgo(2, 15, 40),
    kind: 'petty-out',
    amount: pounds(12),
    note: 'Courier drop-off',
    staffName: 'Marcus Bell',
  },
  {
    id: 'cash-5',
    date: isoDay(3),
    at: daysAgo(3, 9, 1),
    kind: 'float-open',
    amount: pounds(140),
    note: 'Opening float — short £10, noted',
    staffName: 'Sana Iqbal',
  },
  {
    id: 'cash-6',
    date: isoDay(3),
    at: daysAgo(3, 12, 10),
    kind: 'petty-in',
    amount: pounds(10),
    note: 'Float top-up from safe',
    staffName: 'Tanoli Hussain',
  },
];

/* ---- refunds ---------------------------------------------------------------- */

const seededRefunds: Refund[] = [
  {
    id: 'rfd-1',
    source: 'order',
    // `reference` is the ORDER this came back against; `refundReference` is the
    // refund's own REF- number, which the database mints by trigger (0035).
    reference: 'FNL-1001',
    refundReference: 'REF-1002',
    lines: [
      {
        productId: 'glasspro-2',
        name: 'GlassPro 2 tempered glass',
        quantity: 1,
        unitPrice: pounds(14),
      },
    ],
    amount: pounds(14),
    reason: 'Glass arrived cracked — replaced and refunded fitting',
    tender: 'pos1',
    originalTender: 'pos1',
    restock: false,
    staffId: 'stf-3',
    staffName: 'Sana',
    outsideWindow: false,
    windowOverrideBy: null,
    withinWindow: true,
    at: daysAgo(2, 16, 5),
  },
  {
    id: 'rfd-2',
    source: 'order',
    reference: 'FNL-0961',
    refundReference: 'REF-0998',
    lines: [{ productId: 'volt-65', name: 'Volt 65W charger', quantity: 1, unitPrice: pounds(34) }],
    amount: pounds(34),
    reason: 'Charger developed a fault at 6 weeks — goodwill refund',
    tender: 'cash',
    originalTender: 'stripe',
    restock: false,
    staffId: 'stf-1',
    staffName: 'Tanoli',
    outsideWindow: true,
    windowOverrideBy: 'stf-1',
    withinWindow: false,
    at: daysAgo(8, 11, 30),
  },
  {
    id: 'rfd-3',
    source: 'no-receipt',
    // No original sale to point at — but the refund still has its own
    // reference, which is precisely why the two fields are separate.
    reference: null,
    refundReference: 'REF-1000',
    lines: [
      { productId: 'braid-c2', name: 'Braid-C 2m cable', quantity: 2, unitPrice: pounds(11) },
    ],
    amount: pounds(22),
    reason: 'Gift, no receipt — exchanged for store credit at the counter',
    tender: 'cash',
    originalTender: null,
    restock: true,
    staffId: 'stf-3',
    staffName: 'Sana',
    outsideWindow: true,
    windowOverrideBy: 'stf-1',
    withinWindow: false,
    at: daysAgo(4, 14, 10),
  },
];

/* ---- trade-in payouts (devices bought in over the counter) ------------------ */

const seededTradeInPayouts: TradeInPayout[] = [
  {
    id: 'tip-1',
    reference: 'BUY-2041',
    sellRequestId: 'sell-1001',
    deviceLabel: 'iPhone 13 128GB — Midnight',
    customerName: 'Priya Nair',
    // Negative — money OUT. The mock stores it the same way the database
    // does, so a screen that reads it correctly here reads it correctly there.
    amount: -pounds(180),
    method: 'bank_transfer',
    staffId: 'staff-1001',
    staffName: 'Tanoli',
    notes: 'Quoted online, matched on inspection. Battery health 91%.',
    restocked: true,
    resalePrice: pounds(279),
    restockedProductId: 'prod-restock-1',
    createdAt: daysAgo(3, 15, 20),
  },
  {
    id: 'tip-2',
    reference: 'BUY-2040',
    sellRequestId: null,
    deviceLabel: 'Samsung Galaxy S21 128GB',
    customerName: 'Craig Bell',
    amount: -pounds(95),
    method: 'cash',
    staffId: 'staff-1002',
    staffName: 'Sana',
    notes: 'Walk-in. Small dent, screen clean.',
    // Bought but not yet on the shelf — restocking is a separate decision.
    restocked: false,
    resalePrice: null,
    restockedProductId: null,
    createdAt: daysAgo(9, 11, 5),
  },
];

/**
 * Admin-managed reviews (Round 3 follow-up #4) — the same 8 real reviews the
 * storefront already shows in mock mode, given the extra admin-only fields
 * (published/sortOrder/createdAt) so the mock adapter's CRUD has something
 * real to list, mirroring seededLabels above. Order matches MOCK_REVIEWS'
 * own array order, exactly like the seeded rows in 0053_reviews.sql.
 */
const seededAdminReviews: AdminReview[] = MOCK_REVIEWS.map((r, i) => ({
  ...r,
  published: true,
  sortOrder: i + 1,
  createdAt: daysAgo(30, 10, 0),
}));

/* ---- the admin in-memory store ---------------------------------------------- */

export const adminDb = {
  jobs: seededJobs,
  /**
   * Parts fitted, and money taken, against jobs. Empty seed: both are ledgers,
   * and inventing history in one would put the seeded jobs' payment status and
   * the seeded stock levels out of step with each other from the first render.
   */
  jobParts: [] as JobPart[],
  jobPayments: [] as JobPaymentRecord[],
  staff: [...MOCK_STAFF],
  promotions: seededPromotions,
  labelTemplates: seededLabels,
  cashEntries: seededCash,
  reviews: seededAdminReviews,
  /** End-of-day cash-ups. Empty seed — mock mode starts with nothing closed. */
  dayCloses: [] as DayClose[],
  refunds: seededRefunds,
  tradeInPayouts: seededTradeInPayouts,
  transactions: generateTransactions(),
  settings: { ...DEFAULT_SETTINGS },
  /** Admin-side product list (catalogue + stock meta), mutable via CRUD. */
  products: MOCK_PRODUCTS.map((p): AdminProduct => ({
    ...p,
    ...stockMetaFor(p.id),
    // categoryId (FEATURE-05) — resolved from the same slug every mock
    // product already carries as `category`, so an existing product opens
    // in the edit dialog with its real category preselected.
    categoryId: ADMIN_CATEGORY_ID_BY_SLUG.get(p.category),
  })),
  categories: [...MOCK_ADMIN_CATEGORIES],
};

let jobSeq = 5112;
export function nextJobReference(): string {
  jobSeq += 1;
  return `FNL-${jobSeq}`;
}

/** Buy-ins get their own series so a payout is never mistaken for a sale. */
let buyInSeq = 2041;
export function nextBuyInReference(): string {
  buyInSeq += 1;
  return `BUY-${buyInSeq}`;
}
