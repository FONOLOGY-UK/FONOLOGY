import type { DataAdapter } from './types';
import type {
  AdminProduct,
  AuthUser,
  Booking,
  BookingInput,
  CashEntry,
  Job,
  LabelTemplate,
  Order,
  OrderInput,
  PosTender,
  Product,
  ProductArt,
  ProductCategoryId,
  ProductInput,
  ProductQuery,
  Promotion,
  Refund,
  RepairQuote,
  Sale,
  SellRequest,
  Staff,
  TradeInPayout,
  TrackingResult,
  PartTierId,
} from '../types';
import { deriveStockStatus, nextOrderStatuses, orderStatusLabel } from '../types';
import { computeSellEstimate } from '../sell-pricing';
import { applyPromo } from '../promo';
import { DELIVERY_OPTIONS } from '@/lib/config';
import {
  MOCK_CATEGORIES,
  MOCK_DEVICES,
  MOCK_PART_TIERS,
  MOCK_PRODUCTS,
  MOCK_REPAIR_TYPES,
  MOCK_REVIEWS,
  adminDb,
  latency,
  mockDb,
  nextBuyInReference,
  nextJobReference,
  nextReference,
} from '../mock';
import { parseIsoDay, summariseTransactions } from '../mock/analytics';

/** Mirror of the prototype's price maths: round(basePounds × multiplier). */
function computeQuote(deviceId: string, repairId: string, tierId: PartTierId): RepairQuote {
  const device = MOCK_DEVICES.find((d) => d.id === deviceId);
  const repair = MOCK_REPAIR_TYPES.find((r) => r.id === repairId);
  const tier = MOCK_PART_TIERS.find((t) => t.id === tierId);

  let price: number | null = null;
  if (device && repair && repair.base) {
    const basePence = repair.base[tierId];
    // Compute in pounds then back to pence so the displayed figure matches the
    // prototype exactly (it rounded whole pounds).
    price = Math.round((basePence / 100) * device.priceMultiplier) * 100;
  }

  return {
    deviceId,
    repairId,
    tierId,
    price,
    warranty: tier?.warranty ?? '',
    estTime: repair?.time ?? '',
  };
}

function sortProducts(products: Product[], sort: ProductQuery['sort']): Product[] {
  if (sort === 'price-asc') return [...products].sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') return [...products].sort((a, b) => b.price - a.price);
  return products; // 'featured' = source order
}

export const mockAdapter: DataAdapter = {
  // ---- Shop catalogue ------------------------------------------------------
  async listProducts(query?: ProductQuery) {
    await latency();
    let items = MOCK_PRODUCTS;
    if (query?.category && query.category !== 'all') {
      items = items.filter((p) => p.category === query.category);
    }
    if (query?.search) {
      const q = query.search.toLowerCase();
      items = items.filter(
        (p) => p.name.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q),
      );
    }
    return sortProducts(items, query?.sort);
  },

  async getProductBySlug(slug: string) {
    await latency();
    return MOCK_PRODUCTS.find((p) => p.slug === slug) ?? null;
  },

  async listCategories() {
    await latency();
    return MOCK_CATEGORIES;
  },

  // ---- Repair booking ------------------------------------------------------
  async listDevices() {
    await latency();
    return MOCK_DEVICES;
  },

  async listRepairTypes() {
    await latency();
    return MOCK_REPAIR_TYPES;
  },

  async listPartTiers() {
    await latency();
    return MOCK_PART_TIERS;
  },

  async getRepairQuote(input) {
    await latency();
    return computeQuote(input.deviceId, input.repairId, input.tierId);
  },

  async createBooking(input: BookingInput) {
    await latency();
    const quote =
      input.tierId != null ? computeQuote(input.deviceId, input.repairId, input.tierId) : null;
    const booking: Booking = {
      ...input,
      id: `bkg-${Date.now()}`,
      reference: nextReference(),
      status: 'received',
      price: quote?.price ?? null,
      createdAt: new Date().toISOString(),
    };
    mockDb.bookings.unshift(booking);
    return booking;
  },

  // ---- Reviews -------------------------------------------------------------
  async listReviews() {
    await latency();
    return MOCK_REVIEWS;
  },

  // ---- Shop orders / checkout ---------------------------------------------
  async createOrder(input: OrderInput) {
    await latency();
    const subtotal = input.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    const deliveryFee = DELIVERY_OPTIONS.find((o) => o.id === input.delivery)?.price ?? 0;
    const discount = applyPromo(input.promoCode, subtotal);
    const order: Order = {
      id: `ord-${Date.now()}`,
      reference: nextReference(),
      lines: input.lines,
      name: `${input.firstName} ${input.lastName}`.trim(),
      email: input.email,
      phone: input.phone,
      delivery: input.delivery,
      address: input.address ?? null,
      postcode: input.postcode ?? null,
      subtotal,
      deliveryFee,
      discount,
      total: Math.max(0, subtotal + deliveryFee - discount),
      status: 'paid',
      createdAt: new Date().toISOString(),
    };
    mockDb.orders.unshift(order);
    return order;
  },

  async getOrderByReference(reference: string) {
    await latency();
    return mockDb.orders.find((o) => o.reference === reference) ?? null;
  },

  // ---- Sell / trade-in -----------------------------------------------------
  async createSellRequest(input) {
    await latency();
    const device = MOCK_DEVICES.find((d) => d.id === input.deviceId);
    const estimate = device ? computeSellEstimate(device, input.condition) : null;
    const request: SellRequest = {
      ...input,
      id: `sell-${Date.now()}`,
      reference: nextReference(),
      status: 'received',
      estimate,
      createdAt: new Date().toISOString(),
    };
    mockDb.sellRequests.unshift(request);
    return request;
  },

  async listSellRequests() {
    await latency();
    return [...mockDb.sellRequests];
  },

  // ---- Public tracking -----------------------------------------------------
  async getTracking(reference: string): Promise<TrackingResult | null> {
    await latency();
    const ref = reference.trim().toUpperCase();
    const booking = mockDb.bookings.find((b) => b.reference === ref);
    if (booking) return { kind: 'booking', booking };
    const order = mockDb.orders.find((o) => o.reference === ref);
    if (order) return { kind: 'order', order };
    const sell = mockDb.sellRequests.find((s) => s.reference === ref);
    if (sell) return { kind: 'sell', sell };
    return null;
  },

  // ---- Admin read surface --------------------------------------------------
  async listOrders() {
    await latency();
    return [...mockDb.orders];
  },

  async listBookings() {
    await latency();
    return [...mockDb.bookings];
  },

  async updateOrderStatus(id, status) {
    await latency();
    const order = mockDb.orders.find((o) => o.id === id);
    if (!order) {
      throw new Error('Order not found — it may have been removed.');
    }
    if (order.status !== status && !nextOrderStatuses(order.status).includes(status)) {
      throw new Error(
        `Can’t move an order from “${orderStatusLabel(order.status)}” to “${orderStatusLabel(status)}”.`,
      );
    }
    order.status = status;
    return { ...order };
  },

  // ==========================================================================
  // ADMIN (item 7)
  // ==========================================================================

  // ---- Analytics -----------------------------------------------------------
  async getAnalytics(query) {
    await latency();
    return summariseTransactions(adminDb.transactions, query);
  },

  // ---- Jobs ----------------------------------------------------------------
  async listJobs() {
    await latency();
    return [...adminDb.jobs];
  },

  async createJob(input) {
    await latency();
    const now = new Date().toISOString();
    const job: Job = {
      ...input,
      id: `job-${Date.now()}`,
      reference: nextJobReference(),
      status: 'new',
      source: 'walk-in',
      createdAt: now,
      updatedAt: now,
    };
    adminDb.jobs.unshift(job);
    return job;
  },

  async updateJob(id, patch) {
    await latency();
    const job = adminDb.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Job not found — it may have been removed.');
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    return { ...job };
  },

  // ---- Inventory -----------------------------------------------------------
  async listAdminProducts() {
    await latency();
    return [...adminDb.products];
  },

  async createProduct(input) {
    await latency();
    const product = buildAdminProduct(input, `prd-${Date.now()}`);
    adminDb.products.unshift(product);
    return product;
  },

  async updateProduct(id, input) {
    await latency();
    const index = adminDb.products.findIndex((p) => p.id === id);
    const existing = adminDb.products[index];
    if (!existing) throw new Error('Product not found — it may have been deleted.');
    const updated: AdminProduct = {
      ...buildAdminProduct(input, existing.id),
      slug: existing.slug, // slugs are stable — PDP URLs never break on edit
      art: existing.art,
      tile: existing.tile,
      highlights: existing.highlights,
      specs: existing.specs,
    };
    adminDb.products[index] = updated;
    return updated;
  },

  async deleteProduct(id) {
    await latency();
    const index = adminDb.products.findIndex((p) => p.id === id);
    if (index === -1) throw new Error('Product not found — it may already be deleted.');
    adminDb.products.splice(index, 1);
  },

  async adjustStock(id, delta) {
    await latency();
    const product = adminDb.products.find((p) => p.id === id);
    if (!product) throw new Error('Product not found — it may have been deleted.');
    product.stockQty = Math.max(0, product.stockQty + delta);
    product.stockStatus = deriveStockStatus(product.stockQty, product.stockStatus === 'restocking');
    return { ...product };
  },

  // ---- Promotions ----------------------------------------------------------
  async listPromotions() {
    await latency();
    return [...adminDb.promotions];
  },

  async createPromotion(input) {
    await latency();
    const promotion: Promotion = {
      ...input,
      id: `promo-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    adminDb.promotions.unshift(promotion);
    return promotion;
  },

  async updatePromotion(id, input) {
    await latency();
    const promotion = adminDb.promotions.find((p) => p.id === id);
    if (!promotion) throw new Error('Promotion not found — it may have been deleted.');
    Object.assign(promotion, input);
    return { ...promotion };
  },

  async deletePromotion(id) {
    await latency();
    const index = adminDb.promotions.findIndex((p) => p.id === id);
    if (index === -1) throw new Error('Promotion not found — it may already be deleted.');
    adminDb.promotions.splice(index, 1);
  },

  // ---- Payments / cash / refunds ------------------------------------------
  async listTransactions(query) {
    await latency();
    const from = parseIsoDay(query.from).getTime();
    const toExclusive = parseIsoDay(query.to);
    toExclusive.setDate(toExclusive.getDate() + 1);
    return adminDb.transactions
      .filter((t) => {
        const at = new Date(t.at).getTime();
        return at >= from && at < toExclusive.getTime();
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  },

  async listCashEntries() {
    await latency();
    return [...adminDb.cashEntries].sort((a, b) => b.at.localeCompare(a.at));
  },

  async createCashEntry(input) {
    await latency();
    const entry: CashEntry = {
      ...input,
      id: `cash-${Date.now()}`,
      at: new Date().toISOString(),
    };
    adminDb.cashEntries.unshift(entry);
    return entry;
  },

  async listRefunds() {
    await latency();
    return [...adminDb.refunds].sort((a, b) => b.at.localeCompare(a.at));
  },

  async createRefund(input) {
    await latency();
    const reference = input.reference?.trim().toUpperCase() ?? null;
    const windowDays = adminDb.settings.returnWindowDays;

    // Resolve what was sold, so we can bound the refund and age the sale.
    let soldTotal: number | null = null;
    let soldAt: string | null = null;

    if (input.source === 'order') {
      const order = reference ? mockDb.orders.find((o) => o.reference === reference) : undefined;
      if (!order) {
        throw new Error(`No online order found for ${reference}. Check the reference.`);
      }
      soldTotal = order.total;
      soldAt = order.createdAt;
    } else if (input.source === 'counter') {
      // Counter sales live in the ledger as one row per payment portion, all
      // sharing the receipt reference — sum them for the sale total.
      const rows = adminDb.transactions.filter(
        (t) => t.reference === reference && t.amount > 0 && t.stream === 'shop',
      );
      if (rows.length === 0) {
        throw new Error(`No counter sale found for ${reference}. Check the receipt.`);
      }
      soldTotal = rows.reduce((sum, t) => sum + t.amount, 0);
      soldAt = rows.reduce((earliest, t) => (t.at < earliest ? t.at : earliest), rows[0]!.at);
    }

    if (soldTotal !== null && input.amount > soldTotal) {
      throw new Error('Refund amount is more than what was paid for that sale.');
    }

    const ageDays = soldAt ? (Date.now() - new Date(soldAt).getTime()) / 86400000 : Infinity;
    const withinWindow = input.source !== 'no-receipt' && ageDays <= windowDays;
    if (!withinWindow && !input.override) {
      throw new Error(
        input.source === 'no-receipt'
          ? 'A return with no receipt needs an admin override — the reason is kept on record.'
          : `This sale is outside the ${windowDays}-day return window. ` +
              'Tick the override to refund it anyway — the reason is kept on record.',
      );
    }

    const at = new Date().toISOString();
    const refund: Refund = {
      ...input,
      reference,
      id: `rfd-${Date.now()}`,
      at,
      withinWindow,
    };
    adminDb.refunds.unshift(refund);

    // Goods coming back go onto the shelf, unless they're faulty.
    if (input.restock) {
      for (const line of input.lines) {
        if (!line.productId) continue;
        const product = adminDb.products.find((p) => p.id === line.productId);
        if (!product) continue;
        product.stockQty += line.quantity;
        product.stockStatus = deriveStockStatus(
          product.stockQty,
          product.stockStatus === 'restocking',
        );
      }
    }

    // Refunds show up in the payments ledger as money out.
    adminDb.transactions.push({
      id: `txn-r-${Date.now()}`,
      at,
      stream: 'shop',
      reference: reference ?? 'NO-RECEIPT',
      description: `Refund — ${input.reason}`,
      amount: -input.amount,
      cost: 0,
      tender: input.tender,
      category: null,
    });
    return refund;
  },

  // ---- Trade-ins / buy-ins -------------------------------------------------
  async listTradeInPayouts() {
    await latency();
    return [...adminDb.tradeInPayouts].sort((a, b) => b.at.localeCompare(a.at));
  },

  async createTradeInPayout(input) {
    await latency();
    if (input.sourceReference) {
      const ref = input.sourceReference.trim().toUpperCase();
      const request = mockDb.sellRequests?.find((r) => r.reference === ref);
      if (!request) {
        throw new Error(`No sell request found for ${ref}. Leave it blank for a walk-in buy-in.`);
      }
    }
    const at = new Date().toISOString();
    const payout: TradeInPayout = {
      ...input,
      sourceReference: input.sourceReference?.trim().toUpperCase() || null,
      id: `tip-${Date.now()}`,
      reference: nextBuyInReference(),
      at,
    };
    adminDb.tradeInPayouts.unshift(payout);

    // Money OUT — a negative `trade-in` row, so the payout is deducted from
    // revenue for the period rather than reading as a sale.
    adminDb.transactions.push({
      id: `txn-ti-${Date.now()}`,
      at,
      stream: 'trade-in',
      reference: payout.reference,
      description: `Trade-in payout — ${input.deviceLabel}`,
      amount: -input.amount,
      cost: 0,
      tender: input.tender,
      category: null,
    });
    return payout;
  },

  // ---- Staff ---------------------------------------------------------------
  async listStaff() {
    await latency();
    return [...adminDb.staff];
  },

  async createStaff(input) {
    await latency();
    const member: Staff = {
      ...input,
      id: `stf-${Date.now()}`,
      startedAt: new Date().toISOString().slice(0, 10),
    };
    adminDb.staff.push(member);
    return member;
  },

  async updateStaff(id, input) {
    await latency();
    const member = adminDb.staff.find((s) => s.id === id);
    if (!member) throw new Error('Staff member not found.');
    Object.assign(member, input);
    return { ...member };
  },

  // ---- Label templates -----------------------------------------------------
  async listLabelTemplates() {
    await latency();
    return [...adminDb.labelTemplates];
  },

  async saveLabelTemplate(input) {
    await latency();
    const now = new Date().toISOString();
    if (input.id) {
      const existing = adminDb.labelTemplates.find((t) => t.id === input.id);
      if (!existing) throw new Error('Template not found — it may have been deleted.');
      Object.assign(existing, { ...input, updatedAt: now });
      return { ...existing };
    }
    const template: LabelTemplate = {
      name: input.name,
      lines: input.lines,
      barcode: input.barcode,
      id: `lbl-${Date.now()}`,
      updatedAt: now,
    };
    adminDb.labelTemplates.unshift(template);
    return template;
  },

  async deleteLabelTemplate(id) {
    await latency();
    const index = adminDb.labelTemplates.findIndex((t) => t.id === id);
    if (index === -1) throw new Error('Template not found — it may already be deleted.');
    adminDb.labelTemplates.splice(index, 1);
  },

  // ---- Settings ------------------------------------------------------------
  async getSettings() {
    await latency();
    return { ...adminDb.settings };
  },

  async updateSettings(patch) {
    await latency();
    Object.assign(adminDb.settings, patch);
    return { ...adminDb.settings };
  },

  // ==========================================================================
  // EMPLOYEE POS (item 8)
  // ==========================================================================

  async completeSale(input) {
    await latency();
    const subtotal = input.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const total = Math.max(0, subtotal - input.discount);
    const paid = input.payments.reduce((s, p) => s + p.amount, 0);
    if (paid !== total) {
      throw new Error('Payments don’t add up to the total — check the split.');
    }
    const cost = input.lines.reduce((s, l) => s + l.costPrice * l.quantity, 0);

    // Deduct stock (never below zero) and re-derive the storefront status.
    for (const line of input.lines) {
      const product = adminDb.products.find((p) => p.id === line.productId);
      if (!product) continue;
      product.stockQty = Math.max(0, product.stockQty - line.quantity);
      product.stockStatus = deriveStockStatus(
        product.stockQty,
        product.stockStatus === 'restocking',
      );
    }

    const at = new Date().toISOString();
    const reference = nextReference();
    const itemCount = input.lines.reduce((s, l) => s + l.quantity, 0);

    // One settled transaction per payment portion, cost split pro rata so the
    // ledger and analytics stay coherent. (Backend records line-level detail —
    // see INTEGRATION.md.)
    let costRemaining = cost;
    input.payments.forEach((payment, i) => {
      const isLast = i === input.payments.length - 1;
      const costShare = isLast
        ? costRemaining
        : Math.round((cost * payment.amount) / Math.max(1, total));
      costRemaining -= costShare;
      adminDb.transactions.push({
        id: `txn-pos-${Date.now()}-${i}`,
        at,
        stream: 'shop',
        reference,
        description: `POS sale — ${itemCount} item${itemCount === 1 ? '' : 's'}`,
        amount: payment.amount,
        cost: costShare,
        tender: payment.tender,
        category: null,
      });
    });

    const sale: Sale = {
      id: `sale-${Date.now()}`,
      reference,
      lines: input.lines,
      subtotal,
      discount: input.discount,
      total,
      cost,
      payments: input.payments,
      at,
    };
    return sale;
  },

  async getTodaySummary() {
    await latency();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = adminDb.transactions.filter(
      (t) => t.amount > 0 && new Date(t.at).getTime() >= today.getTime(),
    );
    return {
      date: today.toISOString().slice(0, 10),
      total: rows.reduce((s, t) => s + t.amount, 0),
      // DISTINCT sales — a split payment is several rows under one reference,
      // so count references, not rows. Keeps the header consistent with the
      // day panel's count.
      sales: new Set(rows.map((t) => t.reference)).size,
    };
  },

  async getTodayReport() {
    await latency();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // ALL of today's positive takings — matches the shared header figure
    // (getTodaySummary) so the counter never sees two different "today" totals.
    // A split sale is several rows sharing one reference, so we group by
    // reference to count DISTINCT sales.
    const rows = adminDb.transactions.filter(
      (t) => t.amount > 0 && new Date(t.at).getTime() >= today.getTime(),
    );

    const byRef = new Map<
      string,
      { reference: string; at: string; total: number; tenders: PosTender[]; description: string }
    >();
    for (const row of rows) {
      const existing = byRef.get(row.reference);
      const tender = row.tender === 'stripe' ? 'transfer' : row.tender;
      if (existing) {
        existing.total += row.amount;
        existing.tenders.push(tender);
        if (row.at < existing.at) existing.at = row.at;
      } else {
        byRef.set(row.reference, {
          reference: row.reference,
          at: row.at,
          total: row.amount,
          tenders: [tender],
          description: row.description,
        });
      }
    }

    const sales = [...byRef.values()].sort((a, b) => b.at.localeCompare(a.at));
    const total = rows.reduce((s, t) => s + t.amount, 0);

    const tenderTotals = new Map<PosTender, { count: number; total: number }>();
    for (const row of rows) {
      const tender = (row.tender === 'stripe' ? 'transfer' : row.tender) as PosTender;
      const agg = tenderTotals.get(tender) ?? { count: 0, total: 0 };
      agg.count += 1;
      agg.total += row.amount;
      tenderTotals.set(tender, agg);
    }
    const tenderOrder: PosTender[] = ['cash', 'pos1', 'pos2', 'transfer'];
    const byTender = tenderOrder
      .filter((t) => tenderTotals.has(t))
      .map((t) => ({ tender: t, ...tenderTotals.get(t)! }));

    return {
      date: today.toISOString().slice(0, 10),
      total,
      salesCount: sales.length,
      averageSale: sales.length > 0 ? Math.round(total / sales.length) : 0,
      lastSaleAt: sales[0]?.at ?? null,
      byTender,
      sales,
    };
  },

  // ==========================================================================
  // AUTH (item 9 — mock sessions; Raja replaces with Supabase Auth)
  // ==========================================================================

  async getSession() {
    await latency();
    return readMockSession();
  },

  async signIn(input) {
    await latency();
    const user: AuthUser = {
      id: `usr-${Date.now()}`,
      name: input.email.split('@')[0] ?? 'Customer',
      email: input.email,
      kind: 'customer',
      staffRole: null,
    };
    writeMockSession(user);
    return user;
  },

  async signUp(input) {
    await latency();
    const user: AuthUser = {
      id: `usr-${Date.now()}`,
      name: input.name,
      email: input.email,
      kind: 'customer',
      staffRole: null,
    };
    writeMockSession(user);
    return user;
  },

  async signInWithGoogle() {
    await latency();
    const user: AuthUser = {
      id: 'usr-google-demo',
      name: 'Demo Customer',
      email: 'demo.customer@gmail.com',
      kind: 'customer',
      staffRole: null,
    };
    writeMockSession(user);
    return user;
  },

  async staffSignIn(input) {
    await latency();
    const member = adminDb.staff.find(
      (s) => s.email.toLowerCase() === input.email.trim().toLowerCase(),
    );
    if (!member) {
      throw new Error('No staff account for that email. Ask the owner to add you in Staff.');
    }
    if (!member.active) {
      throw new Error('That staff account is deactivated.');
    }
    const user: AuthUser = {
      id: member.id,
      name: member.name,
      email: member.email,
      kind: 'staff',
      staffRole: member.role,
    };
    writeMockSession(user);
    return user;
  },

  async requestPasswordReset() {
    await latency();
    // Mock: always succeeds — the page shows the "check your inbox" state.
  },

  async signOut() {
    await latency();
    writeMockSession(null);
  },
};

/* ---- mock session storage (survives refresh; a mock, not security) -------- */

const SESSION_KEY = 'fonology-mock-session';

function readMockSession(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeMockSession(user: AuthUser | null): void {
  if (typeof window === 'undefined') return;
  if (user) window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(SESSION_KEY);
}

/* -------------------------------------------------------------------------- */

/** Default tile art per category — until real photography replaces it. */
const CATEGORY_ART: Record<ProductCategoryId, ProductArt> = {
  cases: 'case',
  power: 'charger',
  audio: 'buds',
  protection: 'glass',
  mounts: 'mount',
  vape: 'stand',
  plates: 'tools',
};

/** Assemble a full AdminProduct from the create/edit form payload. */
function buildAdminProduct(input: ProductInput, id: string): AdminProduct {
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return {
    id,
    slug: slug || id,
    name: input.name,
    sub: input.sub,
    category: input.category,
    kind: input.kind,
    price: input.price,
    stockStatus: deriveStockStatus(input.stockQty, input.restocking),
    tag: input.tag?.trim() ? input.tag.trim() : null,
    compatibility: input.compatibility?.trim() ? input.compatibility.trim() : null,
    description: input.description,
    highlights: [],
    specs: [],
    images: input.images,
    art: CATEGORY_ART[input.category],
    tile: 'bone',
    costPrice: input.costPrice,
    stockQty: input.stockQty,
    supplier: input.localBuying ? null : (input.supplier?.trim() ?? null),
    localBuying: input.localBuying,
    buyInForm: input.localBuying ? (input.buyInForm ?? null) : null,
    barcode: input.barcode?.trim() ? input.barcode.trim() : null,
    lowStockAlert: input.lowStockAlert,
    lowStockThreshold: input.lowStockThreshold,
  };
}
