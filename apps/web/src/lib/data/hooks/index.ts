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
  useCreateBooking,
} from './use-repair';
export { useReviews } from './use-reviews';
export {
  useCreateOrder,
  useOrder,
  useOrders,
  useUpdateOrderStatus,
  useBookings,
} from './use-orders';
export { useCreateSellRequest, useSellRequests } from './use-sell';
export { useTracking } from './use-tracking';
export { queryKeys } from './query-keys';

// ---- admin (item 7) ----
export { useJobs, useCreateJob, useUpdateJob } from './use-jobs';
export {
  useAdminProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useAdjustStock,
} from './use-inventory';
export {
  useAnalytics,
  useTransactions,
  useCashEntries,
  useCreateCashEntry,
  useRefunds,
  useCreateRefund,
  useTradeInPayouts,
  useCreateTradeInPayout,
} from './use-finance';
export { useTodaySummary, useTodayReport, useCompleteSale } from './use-pos';
export {
  useSession,
  useSignIn,
  useSignUp,
  useGoogleSignIn,
  useStaffSignIn,
  useRequestPasswordReset,
  useSignOut,
} from './use-auth';
export {
  usePromotions,
  useCreatePromotion,
  useUpdatePromotion,
  useDeletePromotion,
  useStaff,
  useCreateStaff,
  useUpdateStaff,
  useLabelTemplates,
  useSaveLabelTemplate,
  useDeleteLabelTemplate,
  useSettings,
  useUpdateSettings,
} from './use-admin-misc';
