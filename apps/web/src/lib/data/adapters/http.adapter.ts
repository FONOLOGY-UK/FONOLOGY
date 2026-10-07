import { z } from 'zod';
import { currentShopSelection } from '@/lib/stores/shop.store';
import type { DataAdapter } from './types';
import { isSameSite } from '../../same-site';
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
  pendingCostLineSchema,
  cardLimitCheckSchema,
  cashEntrySchema,
  dayCloseSchema,
  shopDaySchema,
  refundSchema,
  deviceSchema,
  repairTypeSchema,
  repairConversionFieldsSchema,
  switchableStaffSchema,
  partTierSchema,
  repairQuoteSchema,
  bookingSchema,
  adminProductSchema,
  productVariantSchema,
  lowStockProductSchema,
  inventorySummarySchema,
  adminCategorySchema,
  productFolderSchema,
  promotionSchema,
  promotionGroupSchema,
  sellRequestSchema,
  sellAcceptPreviewSchema,
  sellRequestPageSchema,
  sellAcceptTokenSchema,
  tradeInPayoutSchema,
  tradeInPayoutPageSchema,
  restockedProductSchema,
  jobSchema,
  adminShopSchema,
  pagedBookingsSchema,
  pagedCashEntriesSchema,
  pagedDayClosesSchema,
  pagedOrdersSchema,
  pagedRefundsSchema,
  pagedTransactionsSchema,
  shopComparisonSchema,
  masterProductSchema,
  shopSummarySchema,
  jobRefundSchema,
  jobTillPaymentResultSchema,
  jobPageSchema,
  jobPartSchema,
  jobPaymentRecordSchema,
  jobOutstandingSchema,
  staffSchema,
  shopSettingsSchema,
  shopDetailsSchema,
  analyticsSummarySchema,
  transactionSchema,
  labelTemplateSchema,
  reviewSchema,
  adminReviewSchema,
  productReviewSchema,
  reviewEligibilitySchema,
  adminProductReviewSchema,
  adminDeviceSchema,
  adminRepairTypeSchema,
  adminDeliverySchema,
  customerAddressSchema,
  addressBookEntrySchema,
  orderTrackingResultSchema,
  orderPaymentStatusSchema,
  type AuthUser,
  type CustomerAddress,
  type AddressBookInput,
  type SignInInput,
  type SignUpInput,
  type Product,
  type ProductQuery,
  type OrderInput,
  type DeliveryQuoteInput,
  type OrderStatus,
  type OrderDocumentKind,
  type Id,
  type SaleInput,
  type CashEntryInput,
  type DayCloseInput,
  type RefundInput,
  type BookingInput,
  type PartTierId,
  type ProductInput,
  type VariantInput,
  type CategoryInput,
  type ProductFolderInput,
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
  type AdminShopInput,
  type JobQuery,
  type JobStatusChange,
  type StaffInput,
  type ShopSettingsPatch,
  type AnalyticsQuery,
  type TransactionsQuery,
  type LabelTemplateInput,
  type AdminReviewInput,
  type ProductReviewInput,
  type AdminDeviceInput,
  type AdminRepairTypeInput,
} from '../types';

/**
 * HTTP adapter — the one DataAdapter implementation, calling apps/api.
 *
 * Every response is parsed through its Zod schema in `@/lib/data/types`, so a
 * shape drift fails loudly here rather than deep in a component. The session
 * is an httpOnly cookie (`credentials: 'include'` on every call); there is no
 * token for this code to hold or forward itself.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/**
 * Where a BROWSER call to `apiFetch` actually goes. Not always `API_BASE`
 * directly — see `same-site.ts` and `app/api-proxy/[...path]/route.ts` for
 * the full reasoning (Safari's ITP blocking staging's cross-site session
 * cookie outright). Computed once per module load, not per call: the
 * answer (same-site or not) can't change within a single page's lifetime,
 * and `window.location.hostname` isn't available to read at all outside
 * the browser.
 *
 * Server-side callers of `apiFetch` never reach this: `typeof window ===
 * 'undefined'` there, so this stays `API_BASE` unchanged — correct, since a
 * server-to-server call has no browser cookie jar and thus no SameSite
 * question to dodge. (In practice nothing server-side calls `apiFetch`
 * today — shop-details.ts, the one server-only API caller, fetches
 * `API_BASE` directly and isn't touched by this — but this file has no way
 * to promise that stays true, so it's handled correctly either way.)
 */
const BROWSER_API_BASE = (() => {
  if (typeof window === 'undefined' || !API_BASE) return API_BASE;
  try {
    if (isSameSite(window.location.hostname, new URL(API_BASE).hostname)) return API_BASE;
    return '/api-proxy';
  } catch {
    return API_BASE;
  }
})();

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

/**
 * Dashboard requests carry the shop the owner or manager is looking at as `?shop=`. Only on /admin
 * pages: the till (/pos) always works in the signed-in person's own shop, and the public site has
 * no shop to choose. The server ignores it for employees and checks it for everyone else, so this
 * is a convenience, never a permission.
 */
const SHOP_SCOPED_PREFIXES = [
  '/admin/',
  '/reports',
  '/jobs',
  '/orders',
  '/repair/bookings',
  '/sell',
  '/pos/',
  '/print/queue',
  '/print/agents',
  '/print/jobs',
];

function withShopSelection(path: string): string {
  if (typeof window === 'undefined' || !window.location.pathname.startsWith('/admin')) return path;
  const selected = currentShopSelection();
  if (!selected || /[?&]shop=/.test(path)) return path;
  if (!SHOP_SCOPED_PREFIXES.some((p) => path.startsWith(p))) return path;
  return `${path}${path.includes('?') ? '&' : '?'}shop=${encodeURIComponent(selected)}`;
}

export async function apiFetch(rawPath: string, init?: RequestInit): Promise<Response> {
  const path = withShopSelection(rawPath);
  // A FormData body (product image upload) must NOT get a hardcoded
  // application/json header — fetch needs to set its own
  // multipart/form-data boundary, which forcing this header would break.
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  // A thrown fetch is not a failed request — it is no request at all: the
  // connection never completed. On a cold or sleeping instance that is what
  // happens first, and the browser's own wording for it ("Failed to fetch",
  // "NetworkError when attempting to fetch resource") would otherwise be shown
  // verbatim to whoever is standing at the till. Status 0 marks "never
  // reached the server" for any caller that wants to distinguish it.
  let res: Response;
  try {
    res = await fetch(`${BROWSER_API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: isFormData
        ? init?.headers
        : { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(
      0,
      'Could not reach the server. It may be starting up, or your connection dropped — please wait a few seconds and try again.',
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? messageForStatus(res.status));
  }
  return res;
}

/**
 * What to tell a person when the response carried no message of its own.
 *
 * WHY THIS EXISTS
 * The fallback used to be `Request to /staff/signin failed (429).` — a
 * developer's sentence shown to a shop owner standing at the counter. It
 * names an internal path and an HTTP number and tells them nothing about what
 * to do, so it reads as "the system is broken" when the truth is usually
 * "wait a moment and try again".
 *
 * The API's own errors are always preferred over these, because they are
 * specific ("Too many sign-in attempts...", "Incorrect email or password.").
 * This only fires when there is no JSON body to read — and the reason that
 * happens matters: a bodyless error is almost never the application. It is
 * the layer in front of it. A platform that rate-limits at the edge, a cold
 * instance that has not woken yet, a proxy timing out, a dropped connection.
 * Those are all transient and all worth retrying, which is exactly what these
 * messages say — rather than implying the shop's system has failed.
 */
function messageForStatus(status: number): string {
  if (status === 429) {
    return 'Too many attempts in a row. Please wait a minute, then try again.';
  }
  if (status === 408 || status === 502 || status === 503 || status === 504) {
    return 'The server is not responding right now. It may still be starting up — please wait a few seconds and try again.';
  }
  if (status === 401 || status === 403) {
    return 'You are not signed in, or your session has expired. Please sign in again.';
  }
  if (status >= 500) {
    return 'Something went wrong on our side. Please try again in a moment.';
  }
  return 'That did not go through. Please try again.';
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

  async checkProductAvailability(productId: string, quantity: number, variantId?: string) {
    const qs = new URLSearchParams({ quantity: String(quantity) });
    // Round 5 Phase 4 #16: a has_variants product's own stock means nothing
    // once it has one — the server checks the named variant's shelf instead.
    if (variantId) qs.set('variantId', variantId);
    const res = await apiFetch(
      `/products/${encodeURIComponent(productId)}/availability?${qs.toString()}`,
    );
    return z.object({ available: z.boolean() }).parse(await res.json()).available;
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
  // it.
  async createSellRequest(input: SellRequestInput) {
    const res = await apiFetch('/sell/requests', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return sellRequestSchema.parse(await res.json());
  },

  // ---- Reviews ----
  // Round 3 follow-up #4: real, public GET /reviews now exists — see
  // reviews.routes.ts. Published-only, already in display order.
  async listReviews() {
    const res = await apiFetch('/reviews');
    return reviewSchema.array().parse(await res.json());
  },

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
    // In the body, not the query string: the email is the guest's proof of
    // ownership, and a URL ends up in server and proxy logs.
    const res = await apiFetch(`/orders/${encodeURIComponent(reference)}/payment-intent`, {
      method: 'POST',
      body: JSON.stringify(email ? { email } : {}),
    });
    return paymentIntentSchema.parse(await res.json());
  },

  async lookupOrderAsStaff(reference: string) {
    const res = await apiFetch(`/orders/lookup/${encodeURIComponent(reference)}`);
    const body = await res.json();
    return body === null ? null : orderSchema.parse(body);
  },

  // ---- Public tracking (Round 5 Phase 3 #23) --------------------------------
  async getOrderTracking(reference: string) {
    const res = await apiFetch(`/orders/${encodeURIComponent(reference)}/tracking`);
    const body = await res.json();
    return body === null ? null : orderTrackingResultSchema.parse(body);
  },

  async getOrderPaymentStatus(reference: string, intentId: string) {
    const res = await apiFetch(
      `/orders/${encodeURIComponent(reference)}/payment-status?intent=${encodeURIComponent(intentId)}`,
    );
    return orderPaymentStatusSchema.parse(await res.json());
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

  async listMyOrders() {
    const res = await apiFetch('/orders/mine');
    return orderSchema.array().parse(await res.json());
  },

  async listMyBookings() {
    const res = await apiFetch('/repair/bookings/mine');
    return bookingSchema.array().parse(await res.json());
  },

  async listAddressBook() {
    const res = await apiFetch('/auth/customer/addresses');
    return addressBookEntrySchema.array().parse(await res.json());
  },

  async saveAddressBookEntry(input: AddressBookInput & { id?: Id }) {
    const { id, ...body } = input;
    const res = id
      ? await apiFetch(`/auth/customer/addresses/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      : await apiFetch('/auth/customer/addresses', { method: 'POST', body: JSON.stringify(body) });
    return addressBookEntrySchema.parse(await res.json());
  },

  async setDefaultAddressBookEntry(id: Id) {
    await apiFetch(`/auth/customer/addresses/${encodeURIComponent(id)}/default`, {
      method: 'POST',
    });
  },

  async deleteAddressBookEntry(id: Id) {
    await apiFetch(`/auth/customer/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

  // Bug fix: the API side
  // (orders.routes.ts's /:reference/documents routes) already existed —
  // this adapter is the first frontend caller. The list endpoint returns
  // the DB rows verbatim (snake_case, and storage_path never leaves the
  // server); mapped to the camelCase shape components read.
  async listOrderDocuments(reference: string) {
    const res = await apiFetch(`/orders/${encodeURIComponent(reference)}/documents`);
    const rows = z
      .array(
        z.object({
          id: z.string(),
          kind: z.enum(['v5c', 'driving_licence']),
          status: z.enum(['pending', 'approved', 'rejected']),
          reviewed_by: z.string().nullable(),
          reviewed_at: z.string().nullable(),
          rejection_reason: z.string().nullable(),
          uploaded_at: z.string(),
        }),
      )
      .parse(await res.json());
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      rejectionReason: r.rejection_reason,
      uploadedAt: r.uploaded_at,
    }));
  },

  async approveOrderDocument(reference: string, kind: OrderDocumentKind) {
    await apiFetch(
      `/orders/${encodeURIComponent(reference)}/documents/${encodeURIComponent(kind)}/approve`,
      { method: 'POST' },
    );
  },

  async rejectOrderDocument(reference: string, kind: OrderDocumentKind, reason: string) {
    await apiFetch(
      `/orders/${encodeURIComponent(reference)}/documents/${encodeURIComponent(kind)}/reject`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  },

  async getOrderDocumentDownloadUrl(reference: string, kind: OrderDocumentKind) {
    const res = await apiFetch(
      `/orders/${encodeURIComponent(reference)}/documents/${encodeURIComponent(kind)}/view`,
    );
    const parsed = z
      .object({ signedUrl: z.string().nullable(), note: z.string().optional() })
      .parse(await res.json());
    return parsed;
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

  async createJob(input: JobInput) {
    // A deposit is no longer recorded here: money is taken at the till. The screen sends the
    // customer there with the job and the amount (see the Add Job dialog).
    const { depositAmount: _deposit, depositTender: _tender, ...create } = input;
    void _deposit;
    void _tender;
    const res = await apiFetch('/jobs', { method: 'POST', body: JSON.stringify(create) });
    return jobSchema.parse(await res.json());
  },

  async changeJobStatus(id: Id, change: JobStatusChange) {
    const res = await apiFetch(`/jobs/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: JSON.stringify(change),
    });
    const body = await res.json();
    return {
      ...jobSchema.parse(body),
      refunds: jobRefundSchema.array().parse(body?.refunds ?? []),
    };
  },

  async takeJobPaymentAtTill(input: { jobId: Id; payments: SaleInput['payments'] }) {
    const res = await apiFetch('/pos/job-payments', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return jobTillPaymentResultSchema.parse(await res.json());
  },

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

  async getJobOutstanding(id: Id) {
    const res = await apiFetch(`/jobs/${encodeURIComponent(id)}/outstanding`);
    return jobOutstandingSchema.parse(await res.json());
  },

  async listAdminProducts() {
    const res = await apiFetch('/admin/products');
    return adminProductSchema.array().parse(await res.json());
  },

  async listLowStockProducts() {
    const res = await apiFetch('/admin/products/low-stock');
    return lowStockProductSchema.array().parse(await res.json());
  },

  // Backed by inventory_summary() (0079) — see that migration and the
  // adapter interface's own comment for why this isn't derived from
  // listAdminProducts() client-side.
  async getInventorySummary() {
    const res = await apiFetch('/admin/inventory/summary');
    return inventorySummarySchema.parse(await res.json());
  },

  // Shape verified against the route handler: it returns
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

  // Deactivates server-side — never a hard delete.
  async deleteProduct(id: Id) {
    await apiFetch(`/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async restoreProduct(id: Id) {
    const res = await apiFetch(`/admin/products/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
    });
    return adminProductSchema.parse(await res.json());
  },

  async adjustStock(id: Id, delta: number) {
    const res = await apiFetch(`/admin/products/${encodeURIComponent(id)}/stock`, {
      method: 'POST',
      body: JSON.stringify({ delta }),
    });
    return adminProductSchema.parse(await res.json());
  },

  // ---- Product variants (Round 5 Phase 4 #16, trimmed v1) -------------------
  async listProductVariants(productId: Id) {
    const res = await apiFetch(`/admin/products/${encodeURIComponent(productId)}/variants`);
    return productVariantSchema.array().parse(await res.json());
  },

  async createProductVariant(productId: Id, input: VariantInput) {
    const res = await apiFetch(`/admin/products/${encodeURIComponent(productId)}/variants`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return productVariantSchema.parse(await res.json());
  },

  async updateProductVariant(productId: Id, variantId: Id, input: VariantInput) {
    const res = await apiFetch(
      `/admin/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
      { method: 'PUT', body: JSON.stringify(input) },
    );
    return productVariantSchema.parse(await res.json());
  },

  async deleteProductVariant(productId: Id, variantId: Id) {
    await apiFetch(
      `/admin/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
      { method: 'DELETE' },
    );
  },

  async adjustVariantStock(productId: Id, variantId: Id, delta: number) {
    const res = await apiFetch(
      `/admin/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/stock`,
      { method: 'POST', body: JSON.stringify({ delta }) },
    );
    return productVariantSchema.parse(await res.json());
  },

  async uploadOrderDocument(kind: 'v5c' | 'driving_licence', file: File) {
    const body = new FormData();
    // `kind` first: multer streams the parts in order, so a text field sent
    // after the file would not be on req.body when the handler runs.
    body.append('kind', kind);
    body.append('file', file);
    const res = await apiFetch('/orders/documents', { method: 'POST', body });
    const parsed = z.object({ storagePath: z.string().min(1) }).parse(await res.json());
    return parsed.storagePath;
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

  // Round 5 #12: real signed buy-in form upload — see buyInForms.ts on the
  // API side. Returns the storage PATH (not a public URL — the bucket is
  // private), which the form carries in its own `buyInForm` field exactly
  // like `images` carries product-photo URLs, submitted together with the
  // rest of the product on save.
  async uploadBuyInForm(file: File) {
    const body = new FormData();
    body.append('file', file);
    const res = await apiFetch('/admin/products/buy-in-form', { method: 'POST', body });
    const parsed = z.object({ path: z.string() }).parse(await res.json());
    return parsed.path;
  },

  async getBuyInFormDownloadUrl(productId: Id) {
    const res = await apiFetch(`/admin/products/${encodeURIComponent(productId)}/buy-in-form`);
    const parsed = z
      .object({ signedUrl: z.string().url(), filename: z.string() })
      .parse(await res.json());
    return parsed;
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

  async listProductFolders() {
    const res = await apiFetch('/admin/product-folders');
    return productFolderSchema.array().parse(await res.json());
  },

  async createProductFolder(input: ProductFolderInput) {
    const res = await apiFetch('/admin/product-folders', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return productFolderSchema.parse(await res.json());
  },

  async updateProductFolder(id: Id, input: ProductFolderInput) {
    const res = await apiFetch(`/admin/product-folders/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return productFolderSchema.parse(await res.json());
  },

  async deleteProductFolder(id: Id) {
    await apiFetch(`/admin/product-folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

  async setOwnIdleLock(idleLockMinutes: number | null) {
    await apiFetch('/staff/me/idle-lock', {
      method: 'POST',
      body: JSON.stringify({ idleLockMinutes }),
    });
  },

  async listFavouriteProductIds() {
    const res = await apiFetch('/pos/favourites');
    return z
      .string()
      .array()
      .parse(await res.json());
  },

  async pinFavouriteProduct(productId: Id) {
    await apiFetch(`/pos/favourites/${encodeURIComponent(productId)}`, { method: 'POST' });
  },

  async unpinFavouriteProduct(productId: Id) {
    await apiFetch(`/pos/favourites/${encodeURIComponent(productId)}`, { method: 'DELETE' });
  },

  async listPosFolders() {
    const res = await apiFetch('/pos/folders');
    return productFolderSchema.array().parse(await res.json());
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
  async previewSellAcceptance(token: string) {
    const res = await apiFetch('/sell/accept/preview', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    return sellAcceptPreviewSchema.parse(await res.json());
  },

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

  async listAdminReviews() {
    const res = await apiFetch('/admin/reviews');
    return adminReviewSchema.array().parse(await res.json());
  },

  // Same "id present = update" shape as saveLabelTemplate.
  async saveReview(input: AdminReviewInput & { id?: Id }) {
    const { id, ...body } = input;
    const res = id
      ? await apiFetch(`/admin/reviews/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      : await apiFetch('/admin/reviews', { method: 'POST', body: JSON.stringify(body) });
    return adminReviewSchema.parse(await res.json());
  },

  async deleteReview(id: Id) {
    await apiFetch(`/admin/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // ---- Product reviews (Round 5 Phase 4 #21) --------------------------------

  async listProductReviews(productId: Id) {
    const res = await apiFetch(`/reviews/product/${encodeURIComponent(productId)}`);
    return productReviewSchema.array().parse(await res.json());
  },

  async getReviewEligibility(productId: Id) {
    const res = await apiFetch(`/reviews/product/${encodeURIComponent(productId)}/eligibility`);
    return reviewEligibilitySchema.parse(await res.json());
  },

  async submitProductReview(productId: Id, input: ProductReviewInput) {
    await apiFetch(`/reviews/product/${encodeURIComponent(productId)}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async listAdminProductReviews(status?: 'pending' | 'approved') {
    const res = await apiFetch(`/admin/product-reviews${status ? `?status=${status}` : ''}`);
    return adminProductReviewSchema.array().parse(await res.json());
  },

  async approveProductReview(id: Id) {
    const res = await apiFetch(`/admin/product-reviews/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
    return adminProductReviewSchema.parse(await res.json());
  },

  async deleteProductReview(id: Id) {
    await apiFetch(`/admin/product-reviews/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async listTransactionsPage(query) {
    const res = await apiFetch(
      `/reports/transactions${toQuery({
        from: query.from,
        to: query.to,
        staffId: query.staffId,
        tender: query.tender,
        search: query.search,
        limit: String(query.limit),
        offset: String(query.offset),
      })}`,
    );
    return pagedTransactionsSchema.parse(await res.json());
  },

  async listRefundsPage(request) {
    const res = await apiFetch(
      `/pos/refunds${toQuery({
        search: request.search,
        limit: String(request.limit),
        offset: String(request.offset),
      })}`,
    );
    return pagedRefundsSchema.parse(await res.json());
  },

  async listCashEntriesPage(request) {
    const res = await apiFetch(
      `/pos/cash${toQuery({
        date: request.date,
        search: request.search,
        limit: String(request.limit),
        offset: String(request.offset),
      })}`,
    );
    return pagedCashEntriesSchema.parse(await res.json());
  },

  async listDayClosesPage(request) {
    const res = await apiFetch(
      `/pos/day-close${toQuery({ limit: String(request.limit), offset: String(request.offset) })}`,
    );
    return pagedDayClosesSchema.parse(await res.json());
  },

  async listOrdersPage(query) {
    const res = await apiFetch(
      `/orders${toQuery({
        status: query.status?.join(','),
        search: query.search,
        from: query.from,
        to: query.to,
        sort: query.sort,
        limit: String(query.limit),
        offset: String(query.offset),
      })}`,
    );
    return pagedOrdersSchema.parse(await res.json());
  },

  async listBookingsPage(query) {
    const res = await apiFetch(
      `/repair/bookings${toQuery({
        status: query.status?.join(','),
        search: query.search,
        limit: String(query.limit),
        offset: String(query.offset),
      })}`,
    );
    return pagedBookingsSchema.parse(await res.json());
  },

  async listShops() {
    const res = await apiFetch('/shops');
    return shopSummarySchema.array().parse(await res.json());
  },

  async listMasterProducts(query: { search?: string; barcode?: string }) {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.barcode) params.set('barcode', query.barcode);
    const qs = params.toString();
    const res = await apiFetch(`/admin/master${qs ? `?${qs}` : ''}`);
    return masterProductSchema.array().parse(await res.json());
  },

  async copyMasterProduct(masterId: Id) {
    const res = await apiFetch(`/admin/master/${encodeURIComponent(masterId)}/copy`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return adminProductSchema.parse(await res.json());
  },

  async getShopComparison(query: AnalyticsQuery) {
    const res = await apiFetch(
      `/reports/analytics/compare${toQuery({ from: query.from, to: query.to })}`,
    );
    return shopComparisonSchema.parse(await res.json());
  },

  async listAdminShops() {
    const res = await apiFetch('/admin/shops');
    return adminShopSchema.array().parse(await res.json());
  },

  async saveShop(input: AdminShopInput & { id?: Id }) {
    const { id, ...body } = input;
    const res = id
      ? await apiFetch(`/admin/shops/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      : await apiFetch('/admin/shops', { method: 'POST', body: JSON.stringify(body) });
    return adminShopSchema.parse(await res.json());
  },

  async listAdminDevices() {
    const res = await apiFetch('/admin/devices');
    return adminDeviceSchema.array().parse(await res.json());
  },

  // Same "id present = update" shape as saveReview/saveLabelTemplate.
  async saveDevice(input: AdminDeviceInput & { id?: Id }) {
    const { id, ...body } = input;
    const res = id
      ? await apiFetch(`/admin/devices/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      : await apiFetch('/admin/devices', { method: 'POST', body: JSON.stringify(body) });
    return adminDeviceSchema.parse(await res.json());
  },

  async deleteDevice(id: Id) {
    await apiFetch(`/admin/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async listAdminRepairTypes() {
    const res = await apiFetch('/admin/repair-types');
    return adminRepairTypeSchema.array().parse(await res.json());
  },

  // Same "id present = update" shape as saveDevice.
  async saveRepairType(input: AdminRepairTypeInput & { id?: Id }) {
    const { id, ...body } = input;
    const res = id
      ? await apiFetch(`/admin/repair-types/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      : await apiFetch('/admin/repair-types', { method: 'POST', body: JSON.stringify(body) });
    return adminRepairTypeSchema.parse(await res.json());
  },

  async deleteRepairType(id: Id) {
    await apiFetch(`/admin/repair-types/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // ---- Delivery (0102) ----
  async getAdminDelivery() {
    const res = await apiFetch('/admin/delivery');
    return adminDeliverySchema.parse(await res.json());
  },

  async updateFreeDeliveryThreshold(pence: number) {
    const res = await apiFetch('/admin/delivery/threshold', {
      method: 'PATCH',
      body: JSON.stringify({ freeDeliveryThreshold: pence }),
    });
    return adminDeliverySchema.parse(await res.json());
  },

  async saveDeliveryRate(id: Id, input: { price: number; available: boolean }) {
    const res = await apiFetch(`/admin/delivery/rates/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return adminDeliverySchema.parse(await res.json());
  },

  async addDeliveryPrefix(input: { prefix: string; zoneId: Id }) {
    const res = await apiFetch('/admin/delivery/prefixes', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return adminDeliverySchema.parse(await res.json());
  },

  async removeDeliveryPrefix(prefix: string) {
    const res = await apiFetch(`/admin/delivery/prefixes/${encodeURIComponent(prefix)}`, {
      method: 'DELETE',
    });
    return adminDeliverySchema.parse(await res.json());
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

  async checkBelowCost(input: { lines: SaleInput['lines']; discount: number }) {
    const res = await apiFetch('/pos/sales/below-cost', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return z.object({ belowCost: z.boolean() }).parse(await res.json()).belowCost;
  },

  async getTodaySummary() {
    const res = await apiFetch('/pos/today');
    return todaySummarySchema.parse(await res.json());
  },

  async listSwitchableStaff() {
    const res = await apiFetch('/staff/switchable');
    return switchableStaffSchema.array().parse(await res.json());
  },

  async switchStaffSession(staffId: Id, pin: string) {
    const res = await apiFetch('/staff/session/switch', {
      method: 'POST',
      body: JSON.stringify({ staffId, pin }),
    });
    return authUserSchema.parse(await res.json());
  },

  async listRepairConversionFields() {
    const res = await apiFetch('/repair/conversion-fields');
    return repairConversionFieldsSchema.parse(await res.json());
  },

  async convertBookingToJob(
    bookingId: Id,
    input: { quotedPrice?: number | null; intakeDetails?: Record<string, string> },
  ) {
    const res = await apiFetch(`/repair/bookings/${encodeURIComponent(bookingId)}/convert`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return (await res.json()) as { id: Id; reference: string };
  },

  async generateBarcode() {
    const res = await apiFetch('/admin/barcodes/generate', { method: 'POST' });
    const body = (await res.json()) as { barcode?: unknown };
    if (typeof body.barcode !== 'string' || body.barcode.length === 0) {
      throw new Error('The server did not return a barcode.');
    }
    return body.barcode;
  },

  async checkCardLimit(tender: 'pos1' | 'pos2', amount: number) {
    const res = await apiFetch('/pos/card-limits/check', {
      method: 'POST',
      body: JSON.stringify({ tender, amount }),
    });
    return cardLimitCheckSchema.parse(await res.json());
  },

  async listPendingCostLines() {
    const res = await apiFetch('/pos/misc-lines');
    return pendingCostLineSchema.array().parse(await res.json());
  },

  async setSaleLineCost(id: Id, costPrice: number) {
    await apiFetch(`/pos/misc-lines/${encodeURIComponent(id)}/cost`, {
      method: 'POST',
      body: JSON.stringify({ costPrice }),
    });
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
    return z
      .object({ email: z.string(), verificationRequired: z.boolean() })
      .parse(await res.json());
  },

  // Kicks off the redirect only — see the DataAdapter doc comment. The API
  // runs the whole Google round trip (/auth/google/start → Google →
  // /auth/google/callback) and finally sends the browser to /auth/callback
  // here, signed in or with ?error=.
  //
  // Asks first whether Google is configured, so a missing OAuth client is a
  // sentence on this page rather than an error on someone else's.
  //
  // A full-page navigation to API_BASE itself, never the /api-proxy route:
  // the round trip's state cookie and the session cookie are set by the
  // API's own responses, on the API's own host.
  //
  // `redirectTo` rides along as `next`. The caller must not navigate itself —
  // see the DataAdapter doc comment.
  async signInWithGoogle(redirectTo?: string) {
    const res = await apiFetch('/auth/providers');
    const providers = (await res.json()) as { google?: boolean };
    if (!providers.google) {
      throw new ProviderUnavailableError(
        'Google sign-in isn’t available yet — please use your email address.',
      );
    }

    const start = new URL('/auth/google/start', API_BASE || window.location.origin);
    if (redirectTo && redirectTo !== '/') start.searchParams.set('next', redirectTo);
    window.location.assign(start.toString());
  },

  async confirmEmail(token: string) {
    const res = await apiFetch('/auth/customer/confirm-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    return parseAuthUser(res);
  },

  async checkPasswordResetToken(token: string) {
    const res = await apiFetch('/auth/password-reset/check', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    return z.object({ valid: z.boolean() }).parse(await res.json()).valid;
  },

  async completePasswordReset(token: string, password: string) {
    await apiFetch('/auth/password-reset/complete', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
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

  async getCustomerAddress() {
    const res = await apiFetch('/auth/customer/address');
    const body: unknown = await res.json();
    return body === null ? null : customerAddressSchema.parse(body);
  },

  async saveCustomerAddress(input: CustomerAddress) {
    await apiFetch('/auth/customer/address', { method: 'PUT', body: JSON.stringify(input) });
  },
};
