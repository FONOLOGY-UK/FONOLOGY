import { z } from 'zod';
import type { DataAdapter } from './types';
import { getSupabaseBrowserClient } from '../../supabase-browser';
import {
  printAgentSchema,
  printEnqueueResultSchema,
  printJobSchema,
  authUserSchema,
  productSchema,
  categorySchema,
  orderSchema,
  paymentIntentSchema,
  deliveryQuoteSchema,
  saleSchema,
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
  lowStockProductSchema,
  adminCategorySchema,
  promotionSchema,
  promotionGroupSchema,
  sellRequestSchema,
  sellRequestPageSchema,
  sellAcceptTokenSchema,
  tradeInPayoutSchema,
  tradeInPayoutPageSchema,
  restockedProductSchema,
  jobSchema,
  jobPageSchema,
  jobPartSchema,
  jobPaymentRecordSchema,
  staffSchema,
  shopSettingsSchema,
  shopDetailsSchema,
  analyticsSummarySchema,
  transactionSchema,
  labelTemplateSchema,
  type AuthUser,
  type SignInInput,
  type SignUpInput,
  type Product,
  type ProductQuery,
  type OrderInput,
  type DeliveryQuoteInput,
  type OrderStatus,
  type Id,
  type SaleInput,
  type CashEntryInput,
  type DayCloseInput,
  type RefundInput,
  type BookingInput,
  type PartTierId,
  type ProductInput,
  type CategoryInput,
  type PromotionGroupInput,
  type SellRequestQuery,
  type SellStatus,
  type SellRequestInput,
  type TradeInPayoutQuery,
  type TradeInPayoutInput,
  type RestockInput,
  type JobInput,
  type JobPartInput,
  type JobPaymentInput,
  type JobQuery,
  type JobStatusChange,
  type StaffInput,
  type ShopSettingsPatch,
  type AnalyticsQuery,
  type TransactionsQuery,
  type LabelTemplateInput,
} from '../types';

/**
 * HTTP adapter — SCAFFOLD FOR RAJA.
 * =================================
 * Identical signatures to the mock adapter; every method currently throws.
 * This is the file the backend team fills in. The intended shape:
 *
 *   const res = await fetch(`${API_BASE}/products`, { ... });
 *   if (!res.ok) throw new ApiError(res);
 *   return productSchema.array().parse(await res.json());
 *
 * Boundary-validate responses with the Zod schemas in `@/lib/data/types`, then
 * return the parsed value. Because components only ever touch the TanStack
 * Query hooks, swapping mock -> http is a single env change
 * (NEXT_PUBLIC_DATA_SOURCE=http) with ZERO component edits. See INTEGRATION.md
 * for the full method-by-method request/response contract.
 *
 * AUTH (B1) is implemented for real below — everything else in this file is
 * still the scaffold. The API's session is an httpOnly cookie
 * (`credentials: 'include'` on every auth call); there is no token for this
 * code to hold or forward itself.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/**
 * Parse a LIST response item by item, dropping any row that fails.
 *
 * WHY THIS IS NOT JUST `schema.array().parse()`
 * `.array().parse()` is all-or-nothing: one malformed row throws, the whole
 * response is discarded, and the caller sees an empty screen. That is the
 * correct behaviour for something like an order, where a half-understood
 * response is worse than none. It is the wrong behaviour for a CATALOGUE.
 *
 * It has already happened. The trade-in payout flow writes a resale product
 * into `products` with `category: null` and a UUID for a name. One of those
 * rows is enough to fail the array parse, and the storefront answered with
 * "Nothing here yet - no products in this category right now" while the API
 * was returning 69 products perfectly well. A single bad row took the entire
 * shop down, and it did it silently: 200 OK, no console error, an empty grid.
 *
 * So a bad row is skipped and the other 68 products are still sold. The row is
 * reported loudly in development, because dropping data quietly is how schema
 * drift hides — HARD RULE 9 says these schemas must match the REAL API
 * response, and this must not become the thing that stops anyone noticing when
 * they do not.
 */
function parseList<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  body: unknown,
  label: string,
): T[] {
  if (!Array.isArray(body)) return [];
  const out: T[] = [];
  let dropped = 0;
  for (const row of body) {
    const result = schema.safeParse(row);
    if (result.success) out.push(result.data as T);
    else dropped += 1;
  }
  if (dropped > 0 && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(
      `[http.adapter] ${label}: dropped ${dropped} of ${body.length} row(s) that did not match the schema. ` +
        `The rest are still shown. Run the schema audit (apps/api/scripts/schema-audit.ts) — this is either ` +
        `API/schema drift or bad data upstream, and both are worth fixing rather than tolerating.`,
    );
  }
  return out;
}

function notImplemented(method: string): never {
  throw new Error(
    `[http.adapter] ${method}() is not implemented yet. ` +
      `Set NEXT_PUBLIC_DATA_SOURCE=mock, or implement this method against ${API_BASE || '<NEXT_PUBLIC_API_BASE_URL>'}. See INTEGRATION.md.`,
  );
}

/**
 * A sign-in provider the shop hasn't finished configuring. Distinct from
 * ApiError so callers can show the customer a plain explanation rather than
 * "something went wrong" — the message is already customer-facing.
 */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/** Thrown on any non-2xx response from the API, carrying the status for callers that care. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  // A FormData body (product image upload) must NOT get a hardcoded
  // application/json header — fetch needs to set its own
  // multipart/form-data boundary, which forcing this header would break.
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: isFormData ? init?.headers : { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `Request to ${path} failed (${res.status}).`);
  }
  return res;
}

async function parseAuthUser(res: Response): Promise<AuthUser> {
  return authUserSchema.parse(await res.json());
}

function toQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') q.set(key, value);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const httpAdapter: DataAdapter = {
  // ---- Shop catalogue ----
  async listProducts(query?: ProductQuery) {
    const res = await apiFetch(
      `/products${toQuery({ category: query?.category, search: query?.search, sort: query?.sort })}`,
    );
    // Per-row, so one malformed product cannot empty the whole shop. See
    // parseList above for the incident that made this necessary.
    return parseList<Product>(productSchema, await res.json(), 'listProducts');
  },

  async getProductBySlug(slug: string) {
    const res = await apiFetch(`/products/${encodeURIComponent(slug)}`);
    const body = await res.json();
    return body === null ? null : productSchema.parse(body);
  },

  async listCategories() {
    const res = await apiFetch('/categories');
    return categorySchema.array().parse(await res.json());
  },

  // ---- Repair booking ----
  async listDevices() {
    const res = await apiFetch('/repair/devices');
    return deviceSchema.array().parse(await res.json());
  },

  async listRepairTypes() {
    const res = await apiFetch('/repair/types');
    return repairTypeSchema.array().parse(await res.json());
  },

  async listPartTiers() {
    const res = await apiFetch('/repair/tiers');
    return partTierSchema.array().parse(await res.json());
  },

  async getRepairQuote(input: { deviceId: string; repairId: string; tierId: PartTierId }) {
    const res = await apiFetch(
      `/repair/quote${toQuery({ deviceId: input.deviceId, repairId: input.repairId, tierId: input.tierId })}`,
    );
    return repairQuoteSchema.parse(await res.json());
  },

  async createBooking(input: BookingInput) {
    const res = await apiFetch('/repair/bookings', { method: 'POST', body: JSON.stringify(input) });
    return bookingSchema.parse(await res.json());
  },

  // ---- Sell / trade-in ----
  //
  // This was `notImplemented` for a long time, with a comment saying the real
  // `sell_request_status` enum could not pass the frontend's own
  // `sellRequestSchema.parse()`. That WAS true and is not any more — both
  // sides are now the same seven values ('submitted', 'quoted', 'accepted',
  // 'declined', 'received', 'paid', 'rejected'), checked against
  // 0007_sell.sql. The stale comment outlived the problem it described, and
  // the storefront's whole three-step sell wizard threw on submit because of
  // it: perfect in mock mode, dead against the real API.
  async createSellRequest(input: SellRequestInput) {
    const res = await apiFetch('/sell/requests', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return sellRequestSchema.parse(await res.json());
  },

  // Deliberately still unwired, and this one is honest: nothing calls it.
  // `useSellRequests()` is dead code — the staff queue uses
  // `useSellRequestPage()` against `GET /sell/requests`, which is paginated
  // and filtered and returns an envelope this flat signature cannot express.
  // Wiring it would mean inventing an unpaginated read of a table that grows
  // forever. Delete the hook rather than implement this.
  listSellRequests: () => notImplemented('listSellRequests'),

  // ---- Reviews ----
  listReviews: () => notImplemented('listReviews'),

  // ---- Shop orders / checkout ----
  async getDeliveryQuote(input: DeliveryQuoteInput) {
    const res = await apiFetch('/orders/delivery-quote', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return deliveryQuoteSchema.parse(await res.json());
  },

  async createOrder(input: OrderInput) {
    const res = await apiFetch('/orders', { method: 'POST', body: JSON.stringify(input) });
    return orderSchema.parse(await res.json());
  },

  async createPaymentIntent(reference: string, email?: string) {
    const res = await apiFetch(
      `/orders/${encodeURIComponent(reference)}/payment-intent${toQuery({ email })}`,
      { method: 'POST' },
    );
    return paymentIntentSchema.parse(await res.json());
  },

  async getOrderByReference(reference: string, email?: string) {
    const res = await apiFetch(`/orders/${encodeURIComponent(reference)}${toQuery({ email })}`);
    const body = await res.json();
    return body === null ? null : orderSchema.parse(body);
  },

  // ---- Public tracking ----
  // Checks the two real, proven reference+email endpoints in turn (order,
  // then booking) — both already refuse a wrong email and a non-existent
  // reference identically (a bare `null`), so chaining them preserves that
  // exact privacy property. Sell-request tracking is NOT included here: the
  // real sell_request_status model can't pass the mock's sellRequestSchema
  // (same structural mismatch as createSellRequest/listSellRequests — see
  // the B5/handover reports), so a sell reference always resolves to null,
  // same as before this fix.
  async getTracking(reference: string, email: string) {
    const ref = encodeURIComponent(reference);
    const qs = toQuery({ email });

    const orderRes = await apiFetch(`/orders/${ref}${qs}`);
    const orderBody = await orderRes.json();
    if (orderBody !== null) {
      return { kind: 'order' as const, order: orderSchema.parse(orderBody) };
    }

    const bookingRes = await apiFetch(`/repair/bookings/${ref}${qs}`);
    const bookingBody = await bookingRes.json();
    if (bookingBody !== null) {
      return { kind: 'booking' as const, booking: bookingSchema.parse(bookingBody) };
    }

    return null;
  },

  // ---- Admin read surface ----
  async listOrders() {
    const res = await apiFetch('/orders');
    return orderSchema.array().parse(await res.json());
  },

  async listBookings() {
    const res = await apiFetch('/repair/bookings');
    return bookingSchema.array().parse(await res.json());
  },

  async updateOrderStatus(
    id: Id,
    status: OrderStatus,
    tracking?: { courier?: string; trackingNumber?: string },
  ) {
    const res = await apiFetch(`/orders/id/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        ...(tracking?.courier ? { courier: tracking.courier } : {}),
        ...(tracking?.trackingNumber ? { trackingNumber: tracking.trackingNumber } : {}),
      }),
    });
    return orderSchema.parse(await res.json());
  },

  // ---- Admin (item 7) ----
  async getAnalytics(query: AnalyticsQuery) {
    const res = await apiFetch(`/reports/analytics${toQuery({ from: query.from, to: query.to })}`);
    return analyticsSummarySchema.parse(await res.json());
  },

  // The 4-status Job schema that blocked this is gone — the types now use the
  // API's own seven statuses and field names verbatim, so these parse.
  async listJobs() {
    const res = await apiFetch('/jobs?limit=200');
    return jobPageSchema.parse(await res.json()).items;
  },

  async listJobPage(query?: JobQuery) {
    const res = await apiFetch(
      `/jobs${toQuery({
        status: query?.status?.length ? query.status.join(',') : undefined,
        source: query?.source,
        search: query?.search,
        limit: query?.limit?.toString(),
        offset: query?.offset?.toString(),
      })}`,
    );
    return jobPageSchema.parse(await res.json());
  },

  async getJob(id: Id) {
    const res = await apiFetch(`/jobs/${encodeURIComponent(id)}`);
    return jobSchema.parse(await res.json());
  },

  /**
   * Two calls, deliberately.
   *
   * `POST /jobs` requires `source` and accepts no money at all — a deposit sent
   * in the create body is silently dropped by the route's Zod schema, so the
   * counter would report "£20 taken" and the job would read unpaid. Money goes
   * through `POST /jobs/:id/payments`, where `record_job_payment()` enforces the
   * not-over-the-price cap and derives `payment_status`.
   *
   * If the deposit fails the job still exists (a device on the bench is not lost
   * because the card machine declined), and the error is surfaced rather than
   * swallowed so the counter knows the money wasn't recorded.
   */
  async createJob(input: JobInput) {
    const { depositAmount, ...create } = input;
    const res = await apiFetch('/jobs', { method: 'POST', body: JSON.stringify(create) });
    const job = jobSchema.parse(await res.json());
    if (depositAmount == null || depositAmount <= 0) return job;
    await this.recordJobPayment(job.id, {
      kind: 'deposit',
      amount: depositAmount,
      // The tender is asked for, never assumed: a card deposit booked as cash
      // would show up as a drawer variance at close that nobody could explain.
      tender: input.depositTender ?? 'cash',
    });
    return this.getJob(job.id);
  },

  async changeJobStatus(id: Id, change: JobStatusChange) {
    const res = await apiFetch(`/jobs/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: JSON.stringify(change),
    });
    return jobSchema.parse(await res.json());
  },

  // Free-form field edits have no endpoint yet — status moves go through
  // changeJobStatus, which is what the board actually uses.
  updateJob: () => notImplemented('updateJob'),

  async listJobParts(id: Id) {
    const res = await apiFetch(`/jobs/${encodeURIComponent(id)}/parts`);
    return jobPartSchema.array().parse(await res.json());
  },

  async addJobPart(id: Id, input: JobPartInput) {
    const res = await apiFetch(`/jobs/${encodeURIComponent(id)}/parts`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return jobPartSchema.parse(await res.json());
  },

  async recordJobPayment(id: Id, input: JobPaymentInput) {
    const res = await apiFetch(`/jobs/${encodeURIComponent(id)}/payments`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return jobPaymentRecordSchema.parse(await res.json());
  },

  async listAdminProducts() {
    const res = await apiFetch('/admin/products');
    return adminProductSchema.array().parse(await res.json());
  },

  async listLowStockProducts() {
    const res = await apiFetch('/admin/products/low-stock');
    return lowStockProductSchema.array().parse(await res.json());
  },

  // Shape verified against the route handler, not the mock: it returns
  // `toAdminProduct(row)` — the same shape as GET /admin/products/:id — and a
  // bare `null` (HTTP 200) when nothing matches. Hence `.nullable()`, and no
  // 404 handling: a miss never reaches apiFetch's error path.
  // See apps/api/src/routes/admin.routes.ts (GET /products/barcode/:code).
  async getProductByBarcode(code: string) {
    const res = await apiFetch(`/admin/products/barcode/${encodeURIComponent(code)}`);
    return adminProductSchema.nullable().parse(await res.json());
  },

  async createProduct(input: ProductInput) {
    const res = await apiFetch('/admin/products', { method: 'POST', body: JSON.stringify(input) });
    return adminProductSchema.parse(await res.json());
  },

  async updateProduct(id: Id, input: ProductInput) {
    const res = await apiFetch(`/admin/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return adminProductSchema.parse(await res.json());
  },

  // Deactivates server-side — never a hard delete. See the B6 report: the
  // mock's deleteProduct actually splices the row, which this app must not
  // copy. Same call shape (Promise<void>), different, safer behaviour.
  async deleteProduct(id: Id) {
    await apiFetch(`/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async adjustStock(id: Id, delta: number) {
    const res = await apiFetch(`/admin/products/${encodeURIComponent(id)}/stock`, {
      method: 'POST',
      body: JSON.stringify({ delta }),
    });
    return adminProductSchema.parse(await res.json());
  },

  async uploadProductImage(file: File) {
    const body = new FormData();
    body.append('file', file);
    const res = await apiFetch('/admin/products/images', { method: 'POST', body });
    const parsed = z.object({ url: z.string().url() }).parse(await res.json());
    return parsed.url;
  },

  async deleteProductImage(url: string) {
    await apiFetch('/admin/products/images', {
      method: 'DELETE',
      body: JSON.stringify({ url }),
    });
  },

  async listAdminCategories() {
    const res = await apiFetch('/admin/categories');
    return adminCategorySchema.array().parse(await res.json());
  },

  async createCategory(input: CategoryInput) {
    const res = await apiFetch('/admin/categories', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return adminCategorySchema.parse(await res.json());
  },

  async updateCategory(id: Id, input: CategoryInput) {
    const res = await apiFetch(`/admin/categories/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return adminCategorySchema.parse(await res.json());
  },

  // Real delete — throws ApiError 409 (surfaced via apiFetch's normal error
  // path) while any product or subcategory still references it.
  async deleteCategory(id: Id) {
    await apiFetch(`/admin/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async listPromotions() {
    const res = await apiFetch('/admin/promotions');
    return promotionSchema.array().parse(await res.json());
  },

  async listPromotionGroups() {
    const res = await apiFetch('/admin/promotions/groups');
    return promotionGroupSchema.array().parse(await res.json());
  },

  // One request, one transaction. The API answers 201 on create and 200 on
  // replace; both return the saved group, so the screen never has to guess
  // what ended up stored.
  async savePromotionGroup(input: PromotionGroupInput) {
    const res = await apiFetch('/admin/promotions/bulk', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return promotionGroupSchema.parse(await res.json());
  },

  async deletePromotionGroup(groupId: Id) {
    await apiFetch(`/admin/promotions/group/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
  },

  async listTransactions(query: TransactionsQuery) {
    const res = await apiFetch(
      `/reports/transactions${toQuery({
        from: query.from,
        to: query.to,
        staffId: query.staffId,
        tender: query.tender,
      })}`,
    );
    return transactionSchema.array().parse(await res.json());
  },

  async listCashEntries() {
    const res = await apiFetch('/pos/cash');
    return cashEntrySchema.array().parse(await res.json());
  },

  async createCashEntry(input: CashEntryInput) {
    const res = await apiFetch('/pos/cash', { method: 'POST', body: JSON.stringify(input) });
    return cashEntrySchema.parse(await res.json());
  },

  async getShopDay() {
    const res = await apiFetch('/pos/shop-day');
    return shopDaySchema.parse(await res.json()).date;
  },

  async lockStaffSession() {
    await apiFetch('/staff/session/lock', { method: 'POST' });
  },

  async unlockStaffSession(pin: string) {
    // The PIN leaves the browser exactly once, here, over the same credentialed
    // request everything else uses. It is never stored, never logged, and the
    // server compares it against a hash — it is not held anywhere client-side.
    await apiFetch('/staff/session/unlock', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },

  async setStaffPin(pin: string) {
    await apiFetch('/staff/pin', { method: 'POST', body: JSON.stringify({ pin }) });
  },

  async listDayCloses() {
    const res = await apiFetch('/pos/day-close');
    return dayCloseSchema.array().parse(await res.json());
  },

  async createDayClose(input: DayCloseInput) {
    // Only the count goes up. The expected figure and its breakdown come back
    // down, computed server-side — never sent, never derived here.
    const res = await apiFetch('/pos/day-close', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return dayCloseSchema.parse(await res.json());
  },

  async listRefunds() {
    const res = await apiFetch('/pos/refunds');
    return refundSchema.array().parse(await res.json());
  },

  async createRefund(input: RefundInput) {
    const res = await apiFetch('/pos/refunds', { method: 'POST', body: JSON.stringify(input) });
    return refundSchema.parse(await res.json());
  },
  // ---- Trade-in queue ------------------------------------------------------
  async listSellRequestPage(query?: SellRequestQuery) {
    const res = await apiFetch(
      `/sell/requests${toQuery({
        status: query?.status?.length ? query.status.join(',') : undefined,
        search: query?.search,
        sort: query?.sort,
        limit: query?.limit?.toString(),
        offset: query?.offset?.toString(),
      })}`,
    );
    return sellRequestPageSchema.parse(await res.json());
  },

  async getSellRequest(id: Id) {
    const res = await apiFetch(`/sell/requests/${encodeURIComponent(id)}`);
    return sellRequestSchema.parse(await res.json());
  },

  // Only the amount goes up. `quotedBy` and `quotedAt` come back down, stamped
  // by the server from the session — the browser never says who quoted.
  async quoteSellRequest(id: Id, amount: number) {
    const res = await apiFetch(`/sell/requests/${encodeURIComponent(id)}/quote`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    return sellRequestSchema.parse(await res.json());
  },

  async setSellRequestStatus(id: Id, status: SellStatus) {
    const res = await apiFetch(`/sell/requests/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    return sellRequestSchema.parse(await res.json());
  },

  // The one response that ever carries the plaintext token. It is shown once
  // and never written to storage, state that outlives the dialog, or a log.
  async createSellAcceptToken(id: Id) {
    const res = await apiFetch(`/sell/requests/${encodeURIComponent(id)}/accept-token`, {
      method: 'POST',
    });
    return sellAcceptTokenSchema.parse(await res.json());
  },

  // Guest path: no credentials involved, the token is the whole proof.
  async acceptSellRequest(token: string) {
    const res = await apiFetch('/sell/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    return sellRequestSchema.parse(await res.json());
  },

  async listTradeInPayoutPage(query?: TradeInPayoutQuery) {
    const res = await apiFetch(
      `/sell/payouts${toQuery({
        restocked: query?.restocked === undefined ? undefined : String(query.restocked),
        sellRequestId: query?.sellRequestId,
        search: query?.search,
        limit: query?.limit?.toString(),
        offset: query?.offset?.toString(),
      })}`,
    );
    return tradeInPayoutPageSchema.parse(await res.json());
  },

  async createTradeInPayoutFor(sellRequestId: Id, input: TradeInPayoutInput) {
    const res = await apiFetch(`/sell/requests/${encodeURIComponent(sellRequestId)}/payout`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return tradeInPayoutSchema.parse(await res.json());
  },

  async restockPayout(payoutId: Id, input: RestockInput) {
    const res = await apiFetch(`/sell/payouts/${encodeURIComponent(payoutId)}/restock`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return restockedProductSchema.parse(await res.json());
  },

  // The flat list the old mock-shaped screen used. Kept satisfying the
  // contract by delegating to the paginated endpoint.
  async listTradeInPayouts() {
    const res = await apiFetch('/sell/payouts?limit=200');
    return tradeInPayoutPageSchema.parse(await res.json()).items;
  },

  // Walk-in buy-in, no prior request.
  async createTradeInPayout(input: TradeInPayoutInput) {
    const res = await apiFetch('/sell/payouts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return tradeInPayoutSchema.parse(await res.json());
  },

  async listStaff() {
    const res = await apiFetch('/admin/staff');
    return staffSchema.array().parse(await res.json());
  },

  async createStaff(input: StaffInput) {
    const res = await apiFetch('/admin/staff', { method: 'POST', body: JSON.stringify(input) });
    return staffSchema.parse(await res.json());
  },

  async updateStaff(id: Id, input: StaffInput) {
    // `email` is deliberately not sent: changing it means changing the
    // underlying auth.users identity, which PUT /admin/staff/:id does not do.
    // Sending it would have it silently dropped, which looks like it worked.
    // An empty phone is omitted rather than sent — the API validates the
    // format, and "" is not a valid UK number.
    const { email: _email, phone, ...rest } = input;
    const res = await apiFetch(`/admin/staff/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...rest, ...(phone ? { phone } : {}) }),
    });
    return staffSchema.parse(await res.json());
  },

  async listLabelTemplates() {
    const res = await apiFetch('/admin/labels');
    return labelTemplateSchema.array().parse(await res.json());
  },

  // Create or replace, same "id present = update" shape as
  // savePromotionGroup — the label designer only ever has one save button.
  async saveLabelTemplate(input: LabelTemplateInput & { id?: Id }) {
    const { id, ...body } = input;
    const res = id
      ? await apiFetch(`/admin/labels/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      : await apiFetch('/admin/labels', { method: 'POST', body: JSON.stringify(body) });
    return labelTemplateSchema.parse(await res.json());
  },

  async deleteLabelTemplate(id: Id) {
    await apiFetch(`/admin/labels/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // ---- Printing ------------------------------------------------------------

  async enqueuePrintJob(input) {
    const res = await apiFetch('/print/jobs', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return printEnqueueResultSchema.parse(await res.json());
  },

  async listPrintQueue(opts) {
    const query = opts?.attention ? '?attention=true' : '';
    const res = await apiFetch(`/print/queue${query}`);
    return z.array(printJobSchema).parse(await res.json());
  },

  async resolvePrintJob(id, outcome) {
    await apiFetch(`/print/jobs/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ outcome }),
    });
  },

  async listPrintAgents() {
    const res = await apiFetch('/print/agents');
    return z.array(printAgentSchema).parse(await res.json());
  },

  async getSettings() {
    const res = await apiFetch('/admin/settings');
    return shopSettingsSchema.parse(await res.json());
  },

  // Public — no session needed. See shop.routes.ts.
  async getShopDetails() {
    const res = await apiFetch('/shop');
    return shopDetailsSchema.parse(await res.json());
  },

  async updateSettings(patch: ShopSettingsPatch) {
    const res = await apiFetch('/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) });
    return shopSettingsSchema.parse(await res.json());
  },

  // ---- Employee POS (item 8) ----
  async completeSale(input: SaleInput) {
    const res = await apiFetch('/pos/sales', { method: 'POST', body: JSON.stringify(input) });
    return saleSchema.parse(await res.json());
  },

  async getTodaySummary() {
    const res = await apiFetch('/pos/today');
    return todaySummarySchema.parse(await res.json());
  },

  async getTodayReport() {
    const res = await apiFetch('/pos/today/report');
    return todayReportSchema.parse(await res.json());
  },

  // ---- Auth (item 9) ----
  async getSession() {
    const res = await apiFetch('/auth/session');
    const body = await res.json();
    return body === null ? null : authUserSchema.parse(body);
  },

  async signIn(input: SignInInput) {
    const res = await apiFetch('/auth/customer/signin', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return parseAuthUser(res);
  },

  async signUp(input: SignUpInput) {
    const res = await apiFetch('/auth/customer/signup', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return parseAuthUser(res);
  },

  // Kicks off the redirect only — see the DataAdapter doc comment. The real
  // session exchange happens on /auth/callback (app/(auth)/auth/callback),
  // which calls POST /auth/customer/google directly once Supabase hands
  // back a session.
  //
  // Checks first that Google is actually configured. `signInWithOAuth` does
  // NOT fail when a provider is disabled — it happily builds the URL and sends
  // the browser to Supabase, which answers with raw JSON on its own domain.
  // Asking the API (which reads Supabase's live settings) means the customer
  // gets a sentence they can act on instead, and the day the credentials are
  // added this starts working untouched.
  async signInWithGoogle() {
    const res = await apiFetch('/auth/providers');
    const providers = (await res.json()) as { google?: boolean };
    if (!providers.google) {
      throw new ProviderUnavailableError(
        'Google sign-in isn’t available yet — please use your email address.',
      );
    }

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw new Error(error.message);
  },

  async staffSignIn(input: SignInInput) {
    const res = await apiFetch('/staff/signin', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return parseAuthUser(res);
  },

  async requestPasswordReset(email: string) {
    await apiFetch('/auth/password-reset', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async signOut() {
    await apiFetch('/auth/signout', { method: 'POST' });
  },
};
