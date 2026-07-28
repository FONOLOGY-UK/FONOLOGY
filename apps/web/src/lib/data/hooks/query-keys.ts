import type { AnalyticsQuery, ProductQuery } from '../types';

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
  },
  tracking: (reference: string, email: string) => ['tracking', reference, email] as const,

  // ---- admin (item 7) ----
  analytics: (query: AnalyticsQuery) => ['analytics', query.from, query.to] as const,
  jobs: { all: ['jobs'] as const },
  adminProducts: { all: ['admin-products'] as const },
  promotions: { all: ['promotions'] as const },
  transactions: (query: AnalyticsQuery) => ['transactions', query.from, query.to] as const,
  cashEntries: ['cash-entries'] as const,
  refunds: ['refunds'] as const,
  tradeInPayouts: ['trade-in-payouts'] as const,
  staff: ['staff'] as const,
  labelTemplates: ['label-templates'] as const,
  settings: ['settings'] as const,

  // ---- POS + auth (items 8–9) ----
  todaySummary: ['today-summary'] as const,
  todayReport: ['today-report'] as const,
  session: ['session'] as const,
} as const;
