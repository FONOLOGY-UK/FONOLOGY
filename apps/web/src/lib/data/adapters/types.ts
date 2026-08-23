import type {
  AdminCategory,
  AdminProduct,
  AnalyticsQuery,
  AnalyticsSummary,
  AuthUser,
  Booking,
  BookingInput,
  CashEntry,
  CashEntryInput,
  CategoryInput,
  DayClose,
  DayCloseInput,
  Category,
  DeliveryQuote,
  DeliveryQuoteInput,
  Device,
  Id,
  Job,
  JobInput,
  JobPage,
  JobPart,
  JobPartInput,
  JobPatch,
  JobPaymentInput,
  JobPaymentRecord,
  JobQuery,
  JobStatusChange,
  LabelTemplate,
  LowStockProduct,
  PrintAgent,
  PrintEnqueueInput,
  PrintEnqueueResult,
  PrintJob,
  PrintResolveOutcome,
  LabelTemplateInput,
  Order,
  OrderInput,
  OrderStatus,
  PaymentIntentDetails,
  PartTier,
  Product,
  ProductInput,
  ProductQuery,
  Promotion,
  PromotionGroup,
  PromotionGroupInput,
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
  ShopDetails,
  SignInInput,
  SignUpInput,
  Staff,
  StaffInput,
  TodayReport,
  TodaySummary,
  TrackingResult,
  Transaction,
  TransactionsQuery,
  TradeInPayout,
  TradeInPayoutInput,
  TradeInPayoutPage,
  TradeInPayoutQuery,
  RestockInput,
  RestockedProduct,
  SellRequestPage,
  SellRequestQuery,
  SellStatus,
  SellAcceptToken,
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
  /**
   * What delivery would actually cost — same zone/rate logic createOrder()
   * uses, before the order exists, so the checkout screen can show the real
   * fee instead of a self-picked tier that might not match what's charged.
   */
  getDeliveryQuote(input: DeliveryQuoteInput): Promise<DeliveryQuote>;
  createOrder(input: OrderInput): Promise<Order>;
  /**
   * Begin paying for an order that already exists.
   *
   * Deliberately takes a REFERENCE and not an amount. The order was priced and
   * stored server-side by `createOrder` before this is ever called, and the
   * charge is built from that stored total — there is no amount parameter here
   * for a caller to get wrong or a browser to tamper with.
   *
   * `email` resolves a guest order, exactly as `getOrderByReference` does:
   * references are sequential and guessable, so one alone must never let a
   * stranger start a payment against someone else's order.
   *
   * Returns a null `clientSecret` when the environment has no payment provider
   * (mock adapter) — see PaymentIntentDetails.
   */
  createPaymentIntent(reference: string, email?: string): Promise<PaymentIntentDetails>;
  /**
   * `email` is required to resolve a GUEST order (references are sequential
   * and guessable — reference alone must never return someone's order). Not
   * required when the caller is the signed-in customer who owns the order.
   * Additive over the original mock signature — see the B3 report.
   */
  getOrderByReference(reference: string, email?: string): Promise<Order | null>;

  // ---- Public tracking -----------------------------------------------------
  /**
   * Resolve a reference to a booking or an order (the /track page). `email`
   * is required — references are sequential and guessable, so reference
   * alone must never return someone's order/booking details. A wrong email
   * and a non-existent reference both resolve to `null`, identically —
   * never distinguish the two. Additive over the original mock signature
   * (which took reference only) — see the fix-the-small-stuff report.
   */
  getTracking(reference: string, email: string): Promise<TrackingResult | null>;

  // ---- Admin read surface (dashboard) -------------------------------------
  listOrders(): Promise<Order[]>;
  listBookings(): Promise<Booking[]>;
  /**
   * Move an online order along its fulfilment path (e.g. paid → ready →
   * shipped/collected, or cancelled). Throws on an unknown order or an
   * illegal transition. `tracking` is only meaningful for status:
   * 'shipped' — the API rejects that transition without both fields set.
   * Returns the updated order.
   */
  updateOrderStatus(
    id: Id,
    status: OrderStatus,
    tracking?: { courier?: string; trackingNumber?: string },
  ): Promise<Order>;

  // ==========================================================================
  // ADMIN (item 7). Everything below is dashboard-only — never called from a
  // storefront component. POS mutations (item 8) will extend this same block.
  // ==========================================================================

  // ---- Analytics -----------------------------------------------------------
  /** Aggregated business summary for an inclusive date range. */
  getAnalytics(query: AnalyticsQuery): Promise<AnalyticsSummary>;

  // ---- Jobs (bench pipeline) ----------------------------------------------
  listJobs(): Promise<Job[]>;
  /** The board's paginated, filtered list. */
  listJobPage(query?: JobQuery): Promise<JobPage>;
  getJob(id: Id): Promise<Job>;
  /**
   * A status move plus the evidence that move requires — a revised quote to
   * block on approval, a tracking number to post back, a reason to cancel. The
   * server's transition guard is the authority; this carries what it needs.
   */
  changeJobStatus(id: Id, change: JobStatusChange): Promise<Job>;
  /** Walk-in "Add job" at the counter. Returns the job with its reference. */
  createJob(input: JobInput): Promise<Job>;
  /** Status moves, payment changes, detail edits. */
  updateJob(id: Id, patch: JobPatch): Promise<Job>;
  /** Parts fitted to a job. Cost is frozen at the moment of fitting. */
  listJobParts(id: Id): Promise<JobPart[]>;
  /**
   * Fits a part. This CONSUMES stock from the same pool the shop sells from —
   * it is not a note on a job, it is a stock movement.
   */
  addJobPart(id: Id, input: JobPartInput): Promise<JobPart>;
  /**
   * Records money against a job. The server caps the total at the job's price
   * and derives `paymentStatus` from what it holds.
   */
  recordJobPayment(id: Id, input: JobPaymentInput): Promise<JobPaymentRecord>;

  // ---- Inventory -----------------------------------------------------------
  listAdminProducts(): Promise<AdminProduct[]>;
  /**
   * Active, alert-on, still-in-stock products at/below their own threshold —
   * the DB view's own definition (0043), which matches `productIsLowStock()`
   * exactly. Used by the Overview dashboard's "X low on stock" widget instead
   * of recomputing the check client-side over the full product list.
   */
  listLowStockProducts(): Promise<LowStockProduct[]>;
  /**
   * Barcode lookup for the scanner (till + inventory).
   *
   * Resolves to `null` for an unknown code rather than throwing — the real
   * endpoint answers a miss with HTTP 200 and a JSON `null` body, not a 404,
   * so "no such barcode" is an ordinary answer and only a transport/auth
   * failure is an error. Callers must distinguish the two: an unknown
   * barcode has to be shown to staff, loudly.
   */
  getProductByBarcode(code: string): Promise<AdminProduct | null>;
  createProduct(input: ProductInput): Promise<AdminProduct>;
  updateProduct(id: Id, input: ProductInput): Promise<AdminProduct>;
  deleteProduct(id: Id): Promise<void>;
  /** Quick +/- stock adjustment from the table (never below 0). */
  adjustStock(id: Id, delta: number): Promise<AdminProduct>;
  /**
   * Uploads one product photo and returns its real, public URL — the only
   * place a raw `File` crosses this boundary rather than a typed payload,
   * since this is a genuine binary upload, not a JSON call. The caller adds
   * the returned URL to a product's `images` array; nothing is written to
   * `product_images` until the product itself is created/saved, and that
   * write still passes through the server's own `.url()` validation
   * (BUG-01) regardless of what this returns. Throws ApiError on a rejected
   * file (wrong type, over the size cap) or a failed upload.
   */
  uploadProductImage(file: File): Promise<string>;

  /**
   * Removes a photo that never ended up attached to a saved product (BUG-15
   * hardening) — dropped from the dialog before save, or the dialog
   * cancelled outright with fresh uploads still sitting in it. `url` rather
   * than an id: there may be no product row at all yet in create mode.
   * Best-effort on the caller's side too — this is cleanup, not a step
   * anything else waits on.
   */
  deleteProductImage(url: string): Promise<void>;

  // ---- Categories (FEATURE-05) ----------------------------------------------
  /**
   * Every category, admin's-eye view — real rows with id/parentId, unlike
   * `listCategories()` above (the storefront's flat slug+label filter list).
   */
  listAdminCategories(): Promise<AdminCategory[]>;
  createCategory(input: CategoryInput): Promise<AdminCategory>;
  updateCategory(id: Id, input: CategoryInput): Promise<AdminCategory>;
  /**
   * Real delete — unlike products/suppliers, a category has no sale/order
   * history of its own to preserve. Throws ApiError 409 while any product or
   * subcategory still references it (ON DELETE RESTRICT, migration 0045) —
   * move them first.
   */
  deleteCategory(id: Id): Promise<void>;

  // ---- Promotions (in-store bulk pricing — storefront never reads these) ---
  /**
   * Flat, one entry per product — the shape the TILL wants, for a per-product
   * price lookup. The admin screen uses the grouped methods below.
   */
  listPromotions(): Promise<Promotion[]>;
  /**
   * Grouped, one entry per offer — the shape the ADMIN SCREEN wants, where an
   * offer covering six products is one row, not six.
   */
  listPromotionGroups(): Promise<PromotionGroup[]>;
  /**
   * Creates or replaces a whole offer in ONE transaction. `groupId` absent =
   * create, present = replace. Tiers are replaced wholesale, not merged.
   *
   * There is deliberately no per-product create/update/delete: applying an
   * offer product-by-product can half-succeed, leaving some products at bulk
   * prices and others at shelf prices on real sales.
   */
  savePromotionGroup(input: PromotionGroupInput): Promise<PromotionGroup>;
  deletePromotionGroup(groupId: Id): Promise<void>;

  // ---- Payments / cash / refunds ------------------------------------------
  /** Settled payments inside an inclusive date range, newest first. */
  listTransactions(query: TransactionsQuery): Promise<Transaction[]>;
  listCashEntries(): Promise<CashEntry[]>;
  createCashEntry(input: CashEntryInput): Promise<CashEntry>;
  /** The shop's current trading day (Europe/London), decided by the server. */
  getShopDay(): Promise<string>;

  // ---- Staff session lock -------------------------------------------------
  /** Locks this device's staff session, server-side. */
  lockStaffSession(): Promise<void>;
  /** Unlocks it. Throws ApiError 401 on a wrong (or unset) PIN. */
  unlockStaffSession(pin: string): Promise<void>;
  /** Sets/changes the caller's own 4-digit PIN. */
  setStaffPin(pin: string): Promise<void>;
  /** Past end-of-day cash-ups, newest first, each with its stored breakdown. */
  listDayCloses(): Promise<DayClose[]>;
  /**
   * Close today. The server computes the expected figure and the breakdown —
   * the caller sends only the count. Throws ApiError 409 if this shop day has
   * already been closed.
   */
  createDayClose(input: DayCloseInput): Promise<DayClose>;
  listRefunds(): Promise<Refund[]>;
  /**
   * Record a return. Throws if a supplied reference is unknown, if the amount
   * exceeds what was paid, or if the sale is outside the window / has no
   * receipt and `override` is false. Also posts money out to the ledger and —
   * when `restock` is true — puts the returned line items back into stock.
   */
  createRefund(input: RefundInput): Promise<Refund>;

  // ---- Trade-ins / buy-ins -------------------------------------------------
  /* ---- Trade-in queue (staff) --------------------------------------------
   * Every one of these is gated on `tradein.manage` server-side. Quotes are
   * always a person's figure: the server stamps who and when from the
   * session, and there is no pricing formula anywhere in this path.
   */
  listSellRequestPage(query?: SellRequestQuery): Promise<SellRequestPage>;
  getSellRequest(id: Id): Promise<SellRequest>;
  /** Sets the amount AND moves the request to `quoted`, in one call. */
  quoteSellRequest(id: Id, amount: number): Promise<SellRequest>;
  setSellRequestStatus(id: Id, status: SellStatus): Promise<SellRequest>;
  /**
   * Issues the customer's one-time acceptance link. The plaintext token comes
   * back exactly once, here — only its hash is stored — so it must be shown
   * and never persisted client-side.
   */
  createSellAcceptToken(id: Id): Promise<SellAcceptToken>;
  /** Guest-facing: redeem the token from the link. No auth; the token is the proof. */
  acceptSellRequest(token: string): Promise<SellRequest>;

  listTradeInPayoutPage(query?: TradeInPayoutQuery): Promise<TradeInPayoutPage>;
  /** Walk-in buy-in, no prior request. */
  createTradeInPayoutFor(sellRequestId: Id, input: TradeInPayoutInput): Promise<TradeInPayout>;
  /** Manual, never automatic — the recorded cost is the payout amount. */
  restockPayout(payoutId: Id, input: RestockInput): Promise<RestockedProduct>;

  listTradeInPayouts(): Promise<TradeInPayout[]>;
  /**
   * Record a device bought in from a customer. Posts a NEGATIVE `trade-in`
   * transaction so the payout is deducted from revenue for the period.
   */
  createTradeInPayout(input: TradeInPayoutInput): Promise<TradeInPayout>;

  // ---- Staff ---------------------------------------------------------------
  listStaff(): Promise<Staff[]>;
  createStaff(input: StaffInput): Promise<Staff>;
  updateStaff(id: Id, input: StaffInput): Promise<Staff>;

  // ---- Label templates -----------------------------------------------------
  listLabelTemplates(): Promise<LabelTemplate[]>;
  /** Upsert: with `id` updates that template, without it creates a new one. */
  saveLabelTemplate(input: LabelTemplateInput & { id?: Id }): Promise<LabelTemplate>;
  deleteLabelTemplate(id: Id): Promise<void>;

  // ---- Printing ------------------------------------------------------------
  /**
   * Ask the shop's print agent for a piece of paper.
   *
   * Takes an ENTITY ID, never content — the server loads the sale (or refund,
   * or product) and builds the payload itself. A client that could post a
   * finished payload could print any total it liked onto shop letterhead.
   *
   * A repeated `dedupeKey` is a SUCCESS, not an error: pressing Print twice
   * must be a no-op, not two receipts and a scary message.
   */
  enqueuePrintJob(input: PrintEnqueueInput): Promise<PrintEnqueueResult>;
  /** `attention` narrows to the jobs waiting on a human: unconfirmed + failed. */
  listPrintQueue(opts?: { attention?: boolean }): Promise<PrintJob[]>;
  /**
   * Answer the one question the system cannot: did paper actually come out?
   * `printed` closes the job; `reprint` puts it back on the queue.
   */
  resolvePrintJob(id: Id, outcome: PrintResolveOutcome): Promise<void>;
  /** The agents, their two printers, and health judged against opening hours. */
  listPrintAgents(): Promise<PrintAgent[]>;

  // ---- Settings ------------------------------------------------------------
  getSettings(): Promise<ShopSettings>;
  /**
   * PUBLIC shop details. Unauthenticated on purpose — the storefront has no
   * session and counter staff don't hold `settings.manage`, so this is the
   * only way either of them can read the shop_settings row that 0009 says
   * every screen, receipt and policy page must read.
   */
  getShopDetails(): Promise<ShopDetails>;
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

  /**
   * TODAY's fuller picture for the employee day panel — total, distinct sales,
   * payment mix and the day's sales list. Scoped hard to the current trading
   * day: no history, no cost/margin (permission `sales.today`).
   */
  getTodayReport(): Promise<TodayReport>;

  // ==========================================================================
  // AUTH (item 9 — UI-only; Raja backs this with Supabase Auth or similar)
  // ==========================================================================

  getSession(): Promise<AuthUser | null>;
  signIn(input: SignInInput): Promise<AuthUser>;
  signUp(input: SignUpInput): Promise<AuthUser>;
  /**
   * Starts Google sign-in. This is a REDIRECT flow, not a synchronous
   * exchange — the browser navigates to Google and back, so this can never
   * resolve with an `AuthUser` the way `signIn`/`signUp` do. It resolves
   * once the redirect has been kicked off (or rejects if it couldn't be
   * started, e.g. the provider isn't configured); the actual session is
   * only established once the browser lands back on `/auth/callback`,
   * which calls the real `POST /auth/customer/google` endpoint directly.
   * See the fix-the-small-stuff report.
   */
  signInWithGoogle(): Promise<void>;
  /** Staff sign-in (separate route). Mock: matches the roster by email. */
  staffSignIn(input: SignInInput): Promise<AuthUser>;
  requestPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
}

/** Discriminates which adapter is live. */
export type DataSource = 'mock' | 'http';
