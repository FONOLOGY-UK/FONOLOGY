import type { DataAdapter } from './types';
import type {
  Booking,
  BookingInput,
  Order,
  OrderInput,
  Product,
  ProductQuery,
  RepairQuote,
  SellRequest,
  TrackingResult,
  PartTierId,
} from '../types';
import { DELIVERY_FEE } from '../types';
import { computeSellEstimate } from '../sell-pricing';
import {
  MOCK_CATEGORIES,
  MOCK_DEVICES,
  MOCK_PART_TIERS,
  MOCK_PRODUCTS,
  MOCK_REPAIR_TYPES,
  MOCK_REVIEWS,
  latency,
  mockDb,
  nextReference,
} from '../mock';

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
    const deliveryFee = input.fulfilment === 'deliver' ? DELIVERY_FEE : 0;
    const order: Order = {
      id: `ord-${Date.now()}`,
      reference: nextReference(),
      lines: input.lines,
      name: input.name,
      email: input.email,
      fulfilment: input.fulfilment,
      address: input.address ?? null,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
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
};
