import type {
  AdminProduct,
  AnalyticsQuery,
  AnalyticsSummary,
  AuthUser,
  Booking,
  BookingInput,
  CashEntry,
  CashEntryInput,
  Category,
  Device,
  Id,
  Job,
  JobInput,
  JobPatch,
  LabelTemplate,
  LabelTemplateInput,
  Order,
  OrderInput,
  PartTier,
  Product,
  ProductInput,
  ProductQuery,
  Promotion,
  PromotionInput,
  Refund,
  RefundInput,
  RepairQuote,
  RepairType,
  Review,
  Sale,
  SaleInput,
  SellRequest,
  SellRequestInput,
  ShopSettings,
  ShopSettingsPatch,
  SignInInput,
  SignUpInput,
  Staff,
  StaffInput,
  TodaySummary,
  TrackingResult,
  Transaction,
  PartTierId,
} from '../types';

/**
 * THE CONTRACT
 * ============
 * `DataAdapter` is the single boundary between the UI and any data source.
 * Components NEVER call this directly — they call the TanStack Query hooks in
 * `@/lib/data/hooks`, which call the adapter selected by NEXT_PUBLIC_DATA_SOURCE.
 *
 * Two implementations satisfy this interface:
 *   • mock.adapter.ts  — in-memory fixtures + artificial latency (current)
 *   • http.adapter.ts  — real fetch() calls (Raja fills this in)
 *
 * Every method is fully typed and returns Promises. Adding a capability to the
 * UI means: add a method here first, implement it in mock, stub it in http.
 * See INTEGRATION.md for the request/response mapping.
 */
export interface DataAdapter {
  // ---- Shop catalogue ------------------------------------------------------
  listProducts(query?: ProductQuery): Promise<Product[]>;
  getProductBySlug(slug: string): Promise<Product | null>;
  listCategories(): Promise<Category[]>;

  // ---- Repair booking ------------------------------------------------------
  listDevices(): Promise<Device[]>;
  listRepairTypes(): Promise<RepairType[]>;
  listPartTiers(): Promise<PartTier[]>;
  /** Derived price for a device+repair+tier. price is null for diagnosis-only. */
  getRepairQuote(input: {
    deviceId: string;
    repairId: string;
    tierId: PartTierId;
  }): Promise<RepairQuote>;
  /** Mail-in repair request (no appointment — 6.4). Returns a tracking ref. */
  createBooking(input: BookingInput): Promise<Booking>;

  // ---- Sell / trade-in (6.5) ----------------------------------------------
  createSellRequest(input: SellRequestInput): Promise<SellRequest>;
  listSellRequests(): Promise<SellRequest[]>;

  // ---- Reviews -------------------------------------------------------------
  listReviews(): Promise<Review[]>;

  // ---- Shop orders / checkout ---------------------------------------------
  createOrder(input: OrderInput): Promise<Order>;
  getOrderByReference(reference: string): Promise<Order | null>;

  // ---- Public tracking -----------------------------------------------------
  /** Resolve a reference to a booking or an order (the /track page). */
  getTracking(reference: string): Promise<TrackingResult | null>;

  // ---- Admin read surface (dashboard) -------------------------------------
  listOrders(): Promise<Order[]>;
  listBookings(): Promise<Booking[]>;

  // ==========================================================================
  // ADMIN (item 7). Everything below is dashboard-only — never called from a
  // storefront component. POS mutations (item 8) will extend this same block.
  // ==========================================================================

  // ---- Analytics -----------------------------------------------------------
  /** Aggregated business summary for an inclusive date range. */
  getAnalytics(query: AnalyticsQuery): Promise<AnalyticsSummary>;

  // ---- Jobs (bench pipeline) ----------------------------------------------
  listJobs(): Promise<Job[]>;
  /** Walk-in "Add job" at the counter. Returns the job with its reference. */
  createJob(input: JobInput): Promise<Job>;
  /** Status moves, payment changes, detail edits. */
  updateJob(id: Id, patch: JobPatch): Promise<Job>;

  // ---- Inventory -----------------------------------------------------------
  listAdminProducts(): Promise<AdminProduct[]>;
  createProduct(input: ProductInput): Promise<AdminProduct>;
  updateProduct(id: Id, input: ProductInput): Promise<AdminProduct>;
  deleteProduct(id: Id): Promise<void>;
  /** Quick +/- stock adjustment from the table (never below 0). */
  adjustStock(id: Id, delta: number): Promise<AdminProduct>;

  // ---- Promotions (in-store bulk pricing — storefront never reads these) ---
  listPromotions(): Promise<Promotion[]>;
  createPromotion(input: PromotionInput): Promise<Promotion>;
  updatePromotion(id: Id, input: PromotionInput): Promise<Promotion>;
  deletePromotion(id: Id): Promise<void>;

  // ---- Payments / cash / refunds ------------------------------------------
  /** Settled payments inside an inclusive date range, newest first. */
  listTransactions(query: AnalyticsQuery): Promise<Transaction[]>;
  listCashEntries(): Promise<CashEntry[]>;
  createCashEntry(input: CashEntryInput): Promise<CashEntry>;
  listRefunds(): Promise<Refund[]>;
  /** Throws if the order reference is unknown or the amount exceeds the order. */
  createRefund(input: RefundInput): Promise<Refund>;

  // ---- Staff ---------------------------------------------------------------
  listStaff(): Promise<Staff[]>;
  createStaff(input: StaffInput): Promise<Staff>;
  updateStaff(id: Id, input: StaffInput): Promise<Staff>;

  // ---- Label templates -----------------------------------------------------
  listLabelTemplates(): Promise<LabelTemplate[]>;
  /** Upsert: with `id` updates that template, without it creates a new one. */
  saveLabelTemplate(input: LabelTemplateInput & { id?: Id }): Promise<LabelTemplate>;
  deleteLabelTemplate(id: Id): Promise<void>;

  // ---- Settings ------------------------------------------------------------
  getSettings(): Promise<ShopSettings>;
  updateSettings(patch: ShopSettingsPatch): Promise<ShopSettings>;

  // ==========================================================================
  // EMPLOYEE POS (item 8)
  // ==========================================================================

  /**
   * Complete a counter sale: validates the split-payment sum, deducts stock,
   * records one settled transaction per payment portion, returns the sale
   * for the receipt. Throws with a human message on any rule violation.
   */
  completeSale(input: SaleInput): Promise<Sale>;

  /** TODAY's sales total + count only — the one figure employees may see. */
  getTodaySummary(): Promise<TodaySummary>;

  // ==========================================================================
  // AUTH (item 9 — UI-only; Raja backs this with Supabase Auth or similar)
  // ==========================================================================

  getSession(): Promise<AuthUser | null>;
  signIn(input: SignInInput): Promise<AuthUser>;
  signUp(input: SignUpInput): Promise<AuthUser>;
  signInWithGoogle(): Promise<AuthUser>;
  /** Staff sign-in (separate route). Mock: matches the roster by email. */
  staffSignIn(input: SignInInput): Promise<AuthUser>;
  requestPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
}

/** Discriminates which adapter is live. */
export type DataSource = 'mock' | 'http';
