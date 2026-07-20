import type { DataAdapter } from './types';

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
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

function notImplemented(method: string): never {
  throw new Error(
    `[http.adapter] ${method}() is not implemented yet. ` +
      `Set NEXT_PUBLIC_DATA_SOURCE=mock, or implement this method against ${API_BASE || '<NEXT_PUBLIC_API_BASE_URL>'}. See INTEGRATION.md.`,
  );
}

export const httpAdapter: DataAdapter = {
  // ---- Shop catalogue ----
  listProducts: () => notImplemented('listProducts'),
  getProductBySlug: () => notImplemented('getProductBySlug'),
  listCategories: () => notImplemented('listCategories'),

  // ---- Repair booking ----
  listDevices: () => notImplemented('listDevices'),
  listRepairTypes: () => notImplemented('listRepairTypes'),
  listPartTiers: () => notImplemented('listPartTiers'),
  getRepairQuote: () => notImplemented('getRepairQuote'),
  createBooking: () => notImplemented('createBooking'),

  // ---- Sell / trade-in ----
  createSellRequest: () => notImplemented('createSellRequest'),
  listSellRequests: () => notImplemented('listSellRequests'),

  // ---- Reviews ----
  listReviews: () => notImplemented('listReviews'),

  // ---- Shop orders / checkout ----
  createOrder: () => notImplemented('createOrder'),
  getOrderByReference: () => notImplemented('getOrderByReference'),

  // ---- Public tracking ----
  getTracking: () => notImplemented('getTracking'),

  // ---- Admin read surface ----
  listOrders: () => notImplemented('listOrders'),
  listBookings: () => notImplemented('listBookings'),

  // ---- Admin (item 7) ----
  getAnalytics: () => notImplemented('getAnalytics'),
  listJobs: () => notImplemented('listJobs'),
  createJob: () => notImplemented('createJob'),
  updateJob: () => notImplemented('updateJob'),
  listAdminProducts: () => notImplemented('listAdminProducts'),
  createProduct: () => notImplemented('createProduct'),
  updateProduct: () => notImplemented('updateProduct'),
  deleteProduct: () => notImplemented('deleteProduct'),
  adjustStock: () => notImplemented('adjustStock'),
  listPromotions: () => notImplemented('listPromotions'),
  createPromotion: () => notImplemented('createPromotion'),
  updatePromotion: () => notImplemented('updatePromotion'),
  deletePromotion: () => notImplemented('deletePromotion'),
  listTransactions: () => notImplemented('listTransactions'),
  listCashEntries: () => notImplemented('listCashEntries'),
  createCashEntry: () => notImplemented('createCashEntry'),
  listRefunds: () => notImplemented('listRefunds'),
  createRefund: () => notImplemented('createRefund'),
  listStaff: () => notImplemented('listStaff'),
  createStaff: () => notImplemented('createStaff'),
  updateStaff: () => notImplemented('updateStaff'),
  listLabelTemplates: () => notImplemented('listLabelTemplates'),
  saveLabelTemplate: () => notImplemented('saveLabelTemplate'),
  deleteLabelTemplate: () => notImplemented('deleteLabelTemplate'),
  getSettings: () => notImplemented('getSettings'),
  updateSettings: () => notImplemented('updateSettings'),

  // ---- Employee POS (item 8) ----
  completeSale: () => notImplemented('completeSale'),
  getTodaySummary: () => notImplemented('getTodaySummary'),

  // ---- Auth (item 9) ----
  getSession: () => notImplemented('getSession'),
  signIn: () => notImplemented('signIn'),
  signUp: () => notImplemented('signUp'),
  signInWithGoogle: () => notImplemented('signInWithGoogle'),
  staffSignIn: () => notImplemented('staffSignIn'),
  requestPasswordReset: () => notImplemented('requestPasswordReset'),
  signOut: () => notImplemented('signOut'),
};
