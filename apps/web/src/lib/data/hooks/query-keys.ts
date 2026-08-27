import type {
  SellRequestQuery,
  TradeInPayoutQuery,
  AnalyticsQuery,
  TransactionsQuery,
  JobQuery,
  ProductQuery,
} from '../types';

/**
 * Centralised query-key factory. Every hook derives its key from here so cache
 * invalidation stays consistent and typo-free.
 */
export const queryKeys = {
  products: {
    all: ['products'] as const,
    list: (query?: ProductQuery) => ['products', 'list', query ?? {}] as const,
    detail: (slug: string) => ['products', 'detail', slug] as const,
  },
  categories: ['categories'] as const,
  repair: {
    devices: ['repair', 'devices'] as const,
    types: ['repair', 'types'] as const,
    tiers: ['repair', 'tiers'] as const,
    quote: (deviceId: string, repairId: string, tierId: string) =>
      ['repair', 'quote', deviceId, repairId, tierId] as const,
  },
  reviews: ['reviews'] as const,
  orders: {
    all: ['orders'] as const,
    detail: (reference: string) => ['orders', 'detail', reference] as const,
    deliveryQuote: (linesKey: string, delivery: string, postcode: string) =>
      ['orders', 'delivery-quote', linesKey, delivery, postcode] as const,
  },
  bookings: {
    all: ['bookings'] as const,
  },
  sellRequests: {
    all: ['sell-requests'] as const,
    /** Filters are part of the key so switching status refetches rather than reusing. */
    page: (query?: SellRequestQuery) =>
      [
        'sell-requests',
        'page',
        query?.status?.join(',') ?? '',
        query?.search ?? '',
        query?.sort ?? '',
        query?.limit ?? 0,
        query?.offset ?? 0,
      ] as const,
    detail: (id: string) => ['sell-requests', 'detail', id] as const,
  },
  tracking: (reference: string, email: string) => ['tracking', reference, email] as const,

  // ---- admin (item 7) ----
  analytics: (query: AnalyticsQuery) => ['analytics', query.from, query.to] as const,
  jobs: {
    all: ['jobs'] as const,
    // Board filters are part of the key: two different column sets are two
    // different server queries, not one list filtered twice in the browser.
    page: (query: JobQuery) =>
      [
        'jobs',
        'page',
        query.status?.join(',') ?? '',
        query.source ?? '',
        query.search ?? '',
        query.limit ?? 0,
        query.offset ?? 0,
      ] as const,
    detail: (id: string) => ['jobs', 'detail', id] as const,
    parts: (id: string) => ['jobs', 'parts', id] as const,
  },
  adminProducts: { all: ['admin-products'] as const },
  lowStockProducts: { all: ['low-stock-products'] as const },
  adminCategories: { all: ['admin-categories'] as const },
  promotions: { all: ['promotions'] as const },
  promotionGroups: { all: ['promotion-groups'] as const },
  // staffId/tender included — without them, two different filter
  // combinations for the same date range would collide on one cache entry
  // and silently serve each other's results (FEATURE-13).
  transactions: (query: TransactionsQuery) =>
    ['transactions', query.from, query.to, query.staffId ?? null, query.tender ?? null] as const,
  cashEntries: ['cash-entries'] as const,
  dayCloses: ['day-closes'] as const,
  shopDay: ['shop-day'] as const,
  refunds: ['refunds'] as const,
  tradeInPayouts: ['trade-in-payouts'] as const,
  tradeInPayoutPage: (query?: TradeInPayoutQuery) =>
    [
      'trade-in-payout-page',
      query?.restocked ?? 'all',
      query?.sellRequestId ?? '',
      query?.search ?? '',
      query?.limit ?? 0,
      query?.offset ?? 0,
    ] as const,
  staff: ['staff'] as const,
  labelTemplates: ['label-templates'] as const,
  adminReviews: ['admin-reviews'] as const,
  adminDevices: ['admin-devices'] as const,
  printAgents: ['print-agents'] as const,
  /** Keyed on the filter: the attention list and the full list are separate caches. */
  printQueue: (attention: boolean) => ['print-queue', attention] as const,
  settings: ['settings'] as const,
  shopDetails: ['shop-details'] as const,

  // ---- POS + auth (items 8–9) ----
  todaySummary: ['today-summary'] as const,
  todayReport: ['today-report'] as const,
  session: ['session'] as const,
} as const;
