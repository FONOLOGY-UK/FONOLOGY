/**
 * The ONLY data surface components may import. Components never touch adapters
 * or fetch() directly (HARD RULE #2). Swap mock <-> http via env; these hooks
 * do not change.
 */
export { useProducts, useProduct, useCategories } from './use-products';
export {
  useDevices,
  useRepairTypes,
  usePartTiers,
  useRepairQuote,
  useTimeSlots,
  useCreateBooking,
} from './use-repair';
export { useReviews } from './use-reviews';
export { useCreateOrder, useOrder, useOrders, useBookings } from './use-orders';
export { useTracking } from './use-tracking';
export { queryKeys } from './query-keys';
