import type { DataAdapter } from './types';
import type {
  AdminProduct,
  AuthUser,
  Booking,
  BookingInput,
  CashEntry,
  CashEntryKind,
  DayClose,
  Job,
  JobPart,
  JobPaymentRecord,
  LabelTemplate,
  Order,
  OrderInput,
  DeliveryQuoteInput,
  DeliveryMethod,
  PosTender,
  Product,
  ProductArt,
  ProductCategoryId,
  ProductInput,
  ProductQuery,
  Promotion,
  PromotionGroup,
  Refund,
  RepairQuote,
  Sale,
  SellRequest,
  Staff,
  TradeInPayout,
  TrackingResult,
  PartTierId,
} from '../types';
import {
  deriveStockStatus,
  formatGBP,
  jobStatusLabel,
  nextJobStatuses,
  nextOrderStatuses,
  orderStatusLabel,
} from '../types';
import { applyPromo } from '../promo';
import { DELIVERY_OPTIONS } from '@/lib/config';
import { ROLE_PERMISSIONS } from '@/lib/permissions.config';
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

/**
 * The same dispatch/arrival rule the database applies (0026), mirrored so mock
 * mode doesn't quietly show different dates from the real thing: before the
 * 2pm cut-off dispatches today, at or after it the next working day, weekends
 * skipped. The real figure is the server's — this exists so the mock isn't
 * misleading, not as a second source of truth.
 *
 * It does NOT know about bank holidays (0028), which live in `shop_settings`
 * and change every year. Copying the list here would create a second calendar
 * to keep in step with the first, and a stale copy is worse than a known gap:
 * mock dates can be a working day optimistic around a holiday.
 */
function mockDeliveryEstimate(delivery: DeliveryMethod): {
  dispatchDate: string | null;
  arrivalDate: string | null;
  cutoffTime: string;
  afterCutoff: boolean;
} {
  const CUTOFF_HOUR = 14;
  const now = new Date();
  const afterCutoff = now.getHours() >= CUTOFF_HOUR;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const isWorkingDay = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6;
  const advance = (from: Date, workingDays: number) => {
    const d = new Date(from);
    while (!isWorkingDay(d)) d.setDate(d.getDate() + 1);
    for (let i = 0; i < workingDays; i++) {
      d.setDate(d.getDate() + 1);
      while (!isWorkingDay(d)) d.setDate(d.getDate() + 1);
    }
    return d;
  };

  if (delivery === 'collect') {
    return { dispatchDate: null, arrivalDate: null, cutoffTime: '14:00:00', afterCutoff };
  }

  const start = new Date(now);
  if (afterCutoff || !isWorkingDay(start)) start.setDate(start.getDate() + 1);
  const dispatch = advance(start, 0);
  const arrival = advance(dispatch, delivery === 'next-day' ? 1 : 3);

  return {
    dispatchDate: iso(dispatch),
    arrivalDate: iso(arrival),
    cutoffTime: '14:00:00',
    afterCutoff,
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
  async getDeliveryQuote(input: DeliveryQuoteInput) {
    await latency();
    const estimate = mockDeliveryEstimate(input.delivery);
    if (input.delivery === 'collect') {
      return { deliveryFee: 0, zone: null, ...estimate };
    }
    // Mock has no postcode-zone data (that's the whole point of 0021) —
    // always the standard-zone rate, same simplification createOrder below
    // already made for this adapter.
    const fee = DELIVERY_OPTIONS.find((o) => o.id === input.delivery)?.price ?? 0;
    return { deliveryFee: fee, zone: 'standard', ...estimate };
  },

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
    const request: SellRequest = {
      ...input,
      id: `sell-${Date.now()}`,
      reference: nextReference(),
      deviceId: input.deviceId ?? null,
      deviceOther: input.deviceOther ?? null,
      // 'submitted', not 'received': the request has arrived, the device has
      // not. 'received' is a later state in the real flow.
      status: 'submitted',
      // No figure at submission. Quoting is a person's job — the mock must not
      // imply the shop prices devices automatically.
      quotedAmount: null,
      quotedBy: null,
      quotedAt: null,
      notes: input.notes ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockDb.sellRequests.unshift(request);
    return request;
  },

  async listSellRequests() {
    await latency();
    return [...mockDb.sellRequests];
  },

  // ---- Public tracking -----------------------------------------------------
  async getTracking(reference: string, email: string): Promise<TrackingResult | null> {
    await latency();
    const ref = reference.trim().toUpperCase();
    const em = email.trim().toLowerCase();
    const booking = mockDb.bookings.find(
      (b) => b.reference === ref && b.email.trim().toLowerCase() === em,
    );
    if (booking) return { kind: 'booking', booking };
    const order = mockDb.orders.find(
      (o) => o.reference === ref && o.email.trim().toLowerCase() === em,
    );
    if (order) return { kind: 'order', order };
    const sell = mockDb.sellRequests.find(
      (s) => s.reference === ref && s.email.trim().toLowerCase() === em,
    );
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
      source: input.source,
      // A walk-in "Add job" is unpaid until money is recorded; payment_status is
      // the server's, derived from the payments actually taken.
      paymentStatus: 'unpaid',
      phone: input.phone,
      email: input.email ?? null,
      notes: input.notes ?? null,
      depositAmount: input.depositAmount ?? null,
      revisedQuote: null,
      revisedQuoteApprovedBy: null,
      revisedQuoteApprovedAt: null,
      returnTrackingNumber: null,
      cancellationReason: null,
      deviceReturned: null,
      assignedStaffId: null,
      bookingId: null,
      orderId: null,
      createdAt: now,
      updatedAt: now,
    };
    adminDb.jobs.unshift(job);
    // Same two-step as the real adapter: the deposit is a payment, and payment
    // status is DERIVED from it. Setting the flag directly here would let mock
    // mode show a state the server can't produce.
    if (input.depositAmount != null && input.depositAmount > 0) {
      await this.recordJobPayment(job.id, {
        kind: 'deposit',
        amount: input.depositAmount,
        tender: input.depositTender ?? 'cash',
      });
    }
    return { ...job };
  },

  async listJobPage(query) {
    await latency();
    let items = [...adminDb.jobs];
    if (query?.status?.length) items = items.filter((j) => query.status!.includes(j.status));
    if (query?.source) items = items.filter((j) => j.source === query.source);
    if (query?.search) {
      const q = query.search.toLowerCase();
      items = items.filter(
        (j) =>
          j.reference.toLowerCase().includes(q) ||
          j.customerName.toLowerCase().includes(q) ||
          j.deviceDescription.toLowerCase().includes(q),
      );
    }
    const limit = query?.limit ?? 200;
    const offset = query?.offset ?? 0;
    return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
  },

  async getJob(id) {
    await latency();
    const found = adminDb.jobs.find((j) => j.id === id);
    if (!found) throw new Error('Job not found.');
    return { ...found };
  },

  async changeJobStatus(id, change) {
    await latency();
    const job = adminDb.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Job not found.');

    // The transition guard, mirroring the schema's validate_job_status_transition
    // trigger. Without it the mock accepts moves the database rejects, which is
    // exactly how a board gets built offering buttons that 409 in production.
    if (!nextJobStatuses(job.status, job.source).includes(change.status)) {
      throw new Error(
        `A job that is ${jobStatusLabel(job.status).toLowerCase()} can't move to ${jobStatusLabel(change.status).toLowerCase()}.`,
      );
    }

    // The same evidence the server demands, refused the same way — so the mock
    // can't teach staff a flow the real API rejects.
    if (change.status === 'waiting_approval' && change.revisedQuote == null) {
      throw new Error('A revised quote is required to move a job to waiting_approval.');
    }
    if (change.status === 'sent_back' && !change.returnTrackingNumber?.trim()) {
      throw new Error('A return tracking number is required to post a device back.');
    }
    if (change.status === 'cancelled') {
      if (!change.cancellationReason?.trim()) {
        throw new Error('A cancellation reason is required.');
      }
      if (job.source === 'mail_in' && change.deviceReturned === undefined) {
        throw new Error('Say whether the device has been returned to the customer.');
      }
    }

    job.status = change.status;
    if (change.revisedQuote != null) job.revisedQuote = change.revisedQuote;
    if (change.status === 'in_progress' && change.approved) {
      job.revisedQuoteApprovedBy = readMockSession()?.id ?? 'staff-1001';
      job.revisedQuoteApprovedAt = new Date().toISOString();
    }
    if (change.returnTrackingNumber) job.returnTrackingNumber = change.returnTrackingNumber;
    if (change.cancellationReason) job.cancellationReason = change.cancellationReason;
    if (change.deviceReturned !== undefined) job.deviceReturned = change.deviceReturned;
    job.updatedAt = new Date().toISOString();
    return { ...job };
  },

  async updateJob(id, patch) {
    await latency();
    const job = adminDb.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Job not found — it may have been removed.');
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    return { ...job };
  },

  async listJobParts(id) {
    await latency();
    return adminDb.jobParts.filter((p) => p.jobId === id).map((p) => ({ ...p }));
  },

  /**
   * Fitting a part CONSUMES stock from the same pool the shop sells from —
   * `adminDb.products`, the array the inventory screen reads. It is not a
   * separate "parts" list; if it were, the shop would sell a screen it had
   * already fitted to someone's phone.
   *
   * `unitCost` is copied from the product's cost price AT THIS MOMENT and never
   * read again, so changing the product's cost later leaves this job's figure
   * exactly where it was.
   */
  async addJobPart(id, input) {
    await latency();
    const job = adminDb.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Job not found.');
    const product = adminDb.products.find((p) => p.id === input.productId);
    if (!product) throw new Error('That part isn’t in the catalogue.');
    if (product.stockQty < input.quantity) {
      throw new Error(`Only ${product.stockQty} × ${product.name} left in stock.`);
    }

    product.stockQty -= input.quantity;
    const part: JobPart = {
      id: `jpart-${Date.now()}`,
      jobId: id,
      productId: product.id,
      quantity: input.quantity,
      unitCost: product.costPrice,
      stockMovementId: `mov-${Date.now()}`,
      addedBy: readMockSession()?.id ?? 'staff-1001',
      addedAt: new Date().toISOString(),
    };
    adminDb.jobParts.push(part);
    return { ...part };
  },

  /**
   * The cap the server enforces, enforced here too: cumulative payments can
   * never exceed the job's price. A deposit bigger than the repair is money the
   * shop would owe back and has no record of owing.
   */
  async recordJobPayment(id, input) {
    await latency();
    const job = adminDb.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Job not found.');

    const taken = adminDb.jobPayments
      .filter((p) => p.jobId === id)
      .reduce((sum, p) => sum + p.amount, 0);
    const price = job.revisedQuote ?? job.quotedPrice;
    if (price != null && taken + input.amount > price) {
      throw new Error(
        `That takes the total past the ${formatGBP(price)} price — ${formatGBP(price - taken)} is outstanding.`,
      );
    }

    const payment: JobPaymentRecord = {
      id: `jpay-${Date.now()}`,
      jobId: id,
      kind: input.kind,
      amount: input.amount,
      tender: input.tender,
      staffId: readMockSession()?.id ?? 'staff-1001',
      at: new Date().toISOString(),
    };
    adminDb.jobPayments.push(payment);

    // Payment status is DERIVED, exactly as the server derives it.
    const total = taken + input.amount;
    job.depositAmount = total;
    job.paymentStatus = price != null && total >= price ? 'paid' : 'deposit_paid';
    job.updatedAt = new Date().toISOString();
    return { ...payment };
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
  // Flat view — what the till reads for a per-product price lookup.
  async listPromotions() {
    await latency();
    return [...adminDb.promotions];
  },

  // The mock stores one object per OFFER (many productIds), which is already
  // the group shape — so a stored promotion's `id` serves as its `groupId`.
  // The real database is the other way round (one row per product, joined by
  // group_id); both present the same two views to the app.
  async listPromotionGroups() {
    await latency();
    return adminDb.promotions.map(toMockGroup);
  },

  async savePromotionGroup(input) {
    await latency();
    if (input.groupId) {
      const existing = adminDb.promotions.find((p) => p.id === input.groupId);
      if (!existing) throw new Error('Promotion not found — it may have been deleted.');
      // Replaced wholesale, not merged: the tiers sent are the tiers stored,
      // so removing one removes it.
      existing.name = input.label;
      existing.productIds = [...input.productIds];
      existing.tiers = input.tiers.map((t) => ({ ...t }));
      existing.active = input.active;
      return toMockGroup(existing);
    }
    const promotion: Promotion = {
      id: `promo-${Date.now()}`,
      name: input.label,
      productIds: [...input.productIds],
      tiers: input.tiers.map((t) => ({ ...t })),
      active: input.active,
      createdAt: new Date().toISOString(),
    };
    adminDb.promotions.unshift(promotion);
    return toMockGroup(promotion);
  },

  async deletePromotionGroup(groupId) {
    await latency();
    const index = adminDb.promotions.findIndex((p) => p.id === groupId);
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

  async getShopDay() {
    await latency();
    return new Date().toISOString().slice(0, 10);
  },

  async lockStaffSession() {
    await latency();
    mockLock.locked = true;
  },

  async unlockStaffSession(pin: string) {
    await latency();
    // Stands in for the server's hash comparison so the lock is demonstrable
    // in mock mode. The real check happens server-side against staff.pin_hash.
    if (pin !== mockLock.pin) throw new Error('Incorrect PIN.');
    mockLock.locked = false;
  },

  async setStaffPin(pin: string) {
    await latency();
    mockLock.pin = pin;
  },

  async listDayCloses() {
    await latency();
    return [...adminDb.dayCloses].sort((a, b) => b.date.localeCompare(a.date));
  },

  async createDayClose(input) {
    await latency();
    const today = new Date().toISOString().slice(0, 10);
    if (adminDb.dayCloses.some((d) => d.date === today)) {
      // Mirrors the server's 409 — one close per shop day.
      throw new Error('This trading day has already been closed.');
    }
    // Stands in for the server's computation. Real expected figures are never
    // derived on the client; this exists only so mock mode has something to
    // show, and deliberately includes the cash-payout term.
    const todayEntries = adminDb.cashEntries.filter((e) => e.date === today);
    const sum = (kind: CashEntryKind) =>
      todayEntries.filter((e) => e.kind === kind).reduce((s, e) => s + e.amount, 0);
    const breakdown = {
      floatOpen: sum('float-open'),
      pettyIn: sum('petty-in'),
      pettyOut: sum('petty-out'),
      cashSales: 0,
      cashRefunds: 0,
      cashPayouts: 0,
    };
    const expectedAmount =
      breakdown.floatOpen +
      breakdown.pettyIn -
      breakdown.pettyOut +
      breakdown.cashSales -
      breakdown.cashRefunds -
      breakdown.cashPayouts;
    const close: DayClose = {
      id: `close-${Date.now()}`,
      date: today,
      expectedAmount,
      countedAmount: input.countedAmount,
      variance: input.countedAmount - expectedAmount,
      note: input.note ?? null,
      staffId: null,
      at: new Date().toISOString(),
      breakdown,
    };
    adminDb.dayCloses.unshift(close);
    return close;
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
    // Built field by field, not `...input`: the response shape is not the
    // input shape. The staff member comes from the session (as the API does
    // it from the session cookie), never from the form.
    const actor = readMockSession();
    const refund: Refund = {
      id: `rfd-${Date.now()}`,
      source: input.source,
      reference,
      lines: input.lines,
      amount: input.amount,
      reason: input.reason,
      tender: input.tender,
      // The mock ledger doesn't track what the original sale was paid with.
      originalTender: null,
      restock: input.restock,
      staffId: actor?.id ?? null,
      staffName: actor?.name ?? null,
      outsideWindow: !withinWindow,
      windowOverrideBy: withinWindow ? null : (actor?.id ?? null),
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

  // ---- Trade-in queue ------------------------------------------------------
  async listSellRequestPage(query) {
    await latency();
    let items = [...mockDb.sellRequests];
    if (query?.status?.length) items = items.filter((r) => query.status!.includes(r.status));
    if (query?.search) {
      const q = query.search.toLowerCase();
      items = items.filter(
        (r) =>
          r.reference.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q),
      );
    }
    if (query?.sort === 'created-asc') items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    else items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = query?.limit ?? 50;
    const offset = query?.offset ?? 0;
    return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
  },

  async getSellRequest(id) {
    await latency();
    const found = mockDb.sellRequests.find((r) => r.id === id);
    if (!found) throw new Error('Sell request not found.');
    return { ...found };
  },

  async quoteSellRequest(id, amount) {
    await latency();
    const found = mockDb.sellRequests.find((r) => r.id === id);
    if (!found) throw new Error('Sell request not found.');
    // A person's figure, plus who and when — the same three the server stamps
    // from the session. Nothing here computes a price.
    found.quotedAmount = amount;
    found.quotedBy = readMockSession()?.id ?? 'staff-1001';
    found.quotedAt = new Date().toISOString();
    found.status = 'quoted';
    found.updatedAt = found.quotedAt;
    return { ...found };
  },

  async setSellRequestStatus(id, status) {
    await latency();
    const found = mockDb.sellRequests.find((r) => r.id === id);
    if (!found) throw new Error('Sell request not found.');
    found.status = status;
    found.updatedAt = new Date().toISOString();
    return { ...found };
  },

  async createSellAcceptToken(id) {
    await latency();
    const found = mockDb.sellRequests.find((r) => r.id === id);
    if (!found) throw new Error('Sell request not found.');
    const token = `mock-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    // Mirrors the real thing: the mock keeps only a lookup to the request and
    // marks it unused, never a second copy of the plaintext to hand back later.
    mockAcceptTokens.set(token, { sellRequestId: id, used: false });
    return {
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
  },

  async acceptSellRequest(token) {
    await latency();
    const entry = mockAcceptTokens.get(token);
    // One use only, and an unknown token is indistinguishable from a spent one.
    if (!entry || entry.used) {
      throw new Error('This link is invalid, expired, or has already been used.');
    }
    entry.used = true;
    const found = mockDb.sellRequests.find((r) => r.id === entry.sellRequestId);
    if (!found) throw new Error('This link is invalid, expired, or has already been used.');
    found.status = 'accepted';
    found.updatedAt = new Date().toISOString();
    return { ...found };
  },

  async listTradeInPayoutPage(query) {
    await latency();
    let items = [...adminDb.tradeInPayouts];
    if (query?.restocked !== undefined)
      items = items.filter((p) => p.restocked === query.restocked);
    if (query?.sellRequestId) items = items.filter((p) => p.sellRequestId === query.sellRequestId);
    if (query?.search) {
      const q = query.search.toLowerCase();
      items = items.filter(
        (p) =>
          p.reference.toLowerCase().includes(q) ||
          p.deviceLabel.toLowerCase().includes(q) ||
          p.customerName.toLowerCase().includes(q),
      );
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = query?.limit ?? 50;
    const offset = query?.offset ?? 0;
    return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
  },

  async createTradeInPayoutFor(sellRequestId, input) {
    return mockAdapter.createTradeInPayout({ ...input, __sellRequestId: sellRequestId } as never);
  },

  async restockPayout(payoutId, input) {
    await latency();
    const payout = adminDb.tradeInPayouts.find((p) => p.id === payoutId);
    if (!payout) throw new Error('Payout not found.');
    if (payout.restocked) throw new Error('This device has already been added to stock.');
    payout.restocked = true;
    payout.resalePrice = input.resalePrice;
    const productId = `prod-${Date.now()}`;
    payout.restockedProductId = productId;
    return {
      id: productId,
      slug: input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, ''),
      name: input.name,
      price: input.resalePrice,
      // The cost is what the shop actually paid — the payout, back to positive.
      costPrice: Math.abs(payout.amount),
      stockQty: 1,
    };
  },

  // ---- Trade-ins / buy-ins -------------------------------------------------
  async listTradeInPayouts() {
    await latency();
    return [...adminDb.tradeInPayouts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createTradeInPayout(input) {
    await latency();
    const at = new Date().toISOString();
    const session = readMockSession();
    const payout: TradeInPayout = {
      id: `tip-${Date.now()}`,
      reference: nextBuyInReference(),
      sellRequestId: (input as { __sellRequestId?: string }).__sellRequestId ?? null,
      deviceLabel: input.deviceLabel,
      customerName: input.customerName,
      // Stored NEGATIVE, same as the database. The form sends "what we paid"
      // as a positive number and this is the one place it is negated.
      amount: -input.amount,
      method: input.method,
      staffId: session?.id ?? 'staff-1001',
      staffName: session?.name ?? 'Staff',
      notes: input.notes ?? null,
      // Never restocked on creation — that is a separate, deliberate step.
      restocked: false,
      resalePrice: null,
      restockedProductId: null,
      createdAt: at,
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
      tender: input.method === 'cash' ? 'cash' : 'transfer',
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
      // The mock's own fixtures never produce a null tender (that's a real-
      // backend-only case — split-payment sales and online orders — see
      // Transaction.tender in finance.ts); this cast reflects that invariant.
      const tender = (row.tender === 'stripe' ? 'transfer' : row.tender) as PosTender;
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
      permissions: null,
      locked: false,
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
      permissions: null,
      locked: false,
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
      permissions: null,
      locked: false,
    };
    writeMockSession(user);
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
      locked: false,
      staffRole: member.role,
      permissions: ROLE_PERMISSIONS[member.role],
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

/**
 * Mock stand-in for `staff_sessions.locked` + `staff.pin_hash`. In-memory on
 * purpose: it is a demo of the flow, not a security boundary. Against the real
 * API both live server-side and a reload cannot clear either.
 */
const mockLock = { locked: false, pin: '1234' };

/**
 * A stored mock promotion, viewed as a group. `promotionIds` is synthesised
 * one-per-product to mirror the real database, where each product genuinely
 * has its own row.
 */
function toMockGroup(promotion: Promotion): PromotionGroup {
  return {
    groupId: promotion.id,
    name: promotion.name,
    productIds: [...promotion.productIds],
    promotionIds: promotion.productIds.map((productId) => `${promotion.id}:${productId}`),
    tiers: promotion.tiers.map((t) => ({ ...t })),
    active: promotion.active,
    startsAt: null,
    endsAt: null,
    createdAt: promotion.createdAt,
  };
}

/**
 * Mock acceptance tokens. Deliberately one-use and keyed by the token itself,
 * mirroring the real table: redeeming marks it spent, and a spent token is
 * refused exactly like an unknown one so a customer can't tell them apart.
 */
const mockAcceptTokens = new Map<string, { sellRequestId: string; used: boolean }>();

function readMockSession(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as AuthUser;
    return user.kind === 'staff' ? { ...user, locked: mockLock.locked } : user;
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
