import type {
  Booking,
  BookingInput,
  Category,
  Device,
  Order,
  OrderInput,
  PartTier,
  Product,
  ProductQuery,
  RepairQuote,
  RepairType,
  Review,
  TimeSlot,
  TrackingResult,
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
  /** Available time slots for a calendar day (YYYY-MM-DD). */
  listTimeSlots(date: string): Promise<TimeSlot[]>;
  createBooking(input: BookingInput): Promise<Booking>;

  // ---- Reviews -------------------------------------------------------------
  listReviews(): Promise<Review[]>;

  // ---- Shop orders / checkout ---------------------------------------------
  createOrder(input: OrderInput): Promise<Order>;
  getOrderByReference(reference: string): Promise<Order | null>;

  // ---- Public tracking -----------------------------------------------------
  /** Resolve a reference to a booking or an order (the /track page). */
  getTracking(reference: string): Promise<TrackingResult | null>;

  // ---- Admin read surface (dashboard) -------------------------------------
  // The admin/employee UIs are built in later phases; these read operations are
  // the stable core of that contract. Mutations (status changes, product CRUD)
  // are added here as those surfaces are built, preserving this shape.
  listOrders(): Promise<Order[]>;
  listBookings(): Promise<Booking[]>;
}

/** Discriminates which adapter is live. */
export type DataSource = 'mock' | 'http';
