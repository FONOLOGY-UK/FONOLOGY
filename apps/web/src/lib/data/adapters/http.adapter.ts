import type { DataAdapter } from './types';
import { getSupabaseBrowserClient } from '../../supabase-browser';
import {
  authUserSchema,
  productSchema,
  categorySchema,
  orderSchema,
  deliveryQuoteSchema,
  saleSchema,
  todaySummarySchema,
  todayReportSchema,
  cashEntrySchema,
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
  type AuthUser,
  type SignInInput,
  type SignUpInput,
  type ProductQuery,
  type OrderInput,
  type DeliveryQuoteInput,
  type OrderStatus,
  type Id,
  type SaleInput,
  type CashEntryInput,
  type RefundInput,
  type BookingInput,
  type PartTierId,
  type ProductInput,
  type StaffInput,
  type ShopSettingsPatch,
  type AnalyticsQuery,
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

function notImplemented(method: string): never {
  throw new Error(
    `[http.adapter] ${method}() is not implemented yet. ` +
      `Set NEXT_PUBLIC_DATA_SOURCE=mock, or implement this method against ${API_BASE || '<NEXT_PUBLIC_API_BASE_URL>'}. See INTEGRATION.md.`,
  );
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
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
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
    return productSchema.array().parse(await res.json());
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
  // No adapter wiring for createSellRequest/listSellRequests — see the B5
  // report. The real sell_request_status ('submitted', 'rejected', and a
  // 'received' that means something different from the mock's) cannot pass
  // the mock's own sellRequestSchema.parse() — a real response would fail
  // client-side validation immediately, not degrade gracefully. Built and
  // proven directly against dev instead (apps/api/src/routes/sell.routes.ts).
  createSellRequest: () => notImplemented('createSellRequest'),
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

  async updateOrderStatus(id: Id, status: OrderStatus) {
    const res = await apiFetch(`/orders/id/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    return orderSchema.parse(await res.json());
  },

  // ---- Admin (item 7) ----
  async getAnalytics(query: AnalyticsQuery) {
    const res = await apiFetch(`/reports/analytics${toQuery({ from: query.from, to: query.to })}`);
    return analyticsSummarySchema.parse(await res.json());
  },

  // No adapter wiring for listJobs/createJob/updateJob — see the B5/B6
  // reports. The real job lifecycle (apps/api/src/routes/jobs.routes.ts)
  // cannot pass the mock's 4-status Job schema.
  listJobs: () => notImplemented('listJobs'),
  createJob: () => notImplemented('createJob'),
  updateJob: () => notImplemented('updateJob'),

  async listAdminProducts() {
    const res = await apiFetch('/admin/products');
    return adminProductSchema.array().parse(await res.json());
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

  async listPromotions() {
    const res = await apiFetch('/admin/promotions');
    return promotionSchema.array().parse(await res.json());
  },

  // No adapter wiring for create/update/deletePromotion — see the B6
  // report. The mock's Promotion covers MANY products in one object
  // (productIds: Id[]); the schema scopes one promotions row to exactly one
  // product, so a create/edit call creates/touches several real rows at
  // once — there is no single Promotion object to hand back that doesn't
  // either lose information or misrepresent the underlying rows. Built and
  // proven directly against dev instead.
  createPromotion: () => notImplemented('createPromotion'),
  updatePromotion: () => notImplemented('updatePromotion'),
  deletePromotion: () => notImplemented('deletePromotion'),

  async listTransactions(query: AnalyticsQuery) {
    const res = await apiFetch(
      `/reports/transactions${toQuery({ from: query.from, to: query.to })}`,
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

  async listRefunds() {
    const res = await apiFetch('/pos/refunds');
    return refundSchema.array().parse(await res.json());
  },

  async createRefund(input: RefundInput) {
    const res = await apiFetch('/pos/refunds', { method: 'POST', body: JSON.stringify(input) });
    return refundSchema.parse(await res.json());
  },
  listTradeInPayouts: () => notImplemented('listTradeInPayouts'),
  createTradeInPayout: () => notImplemented('createTradeInPayout'),

  async listStaff() {
    const res = await apiFetch('/admin/staff');
    return staffSchema.array().parse(await res.json());
  },

  async createStaff(input: StaffInput) {
    const res = await apiFetch('/admin/staff', { method: 'POST', body: JSON.stringify(input) });
    return staffSchema.parse(await res.json());
  },

  async updateStaff(id: Id, input: StaffInput) {
    const res = await apiFetch(`/admin/staff/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return staffSchema.parse(await res.json());
  },

  listLabelTemplates: () => notImplemented('listLabelTemplates'),
  saveLabelTemplate: () => notImplemented('saveLabelTemplate'),
  deleteLabelTemplate: () => notImplemented('deleteLabelTemplate'),

  async getSettings() {
    const res = await apiFetch('/admin/settings');
    return shopSettingsSchema.parse(await res.json());
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
  async signInWithGoogle() {
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
