/**
 * The ONLY data surface components may import. Components never touch adapters
 * or fetch() directly (HARD RULE #2). Swap mock <-> http via env; these hooks
 * do not change.
 */
export {
  useProducts,
  useProduct,
  useCategories,
  useCheckProductAvailability,
} from './use-products';
export {
  useDevices,
  useRepairTypes,
  usePartTiers,
  useRepairQuote,
  useTierQuotes,
  useFromQuotes,
  useCreateBooking,
} from './use-repair';
export { useReviews } from './use-reviews';
export {
  useCreateOrder,
  useOrder,
  useOrderLookupAsStaff,
  useOrders,
  useUpdateOrderStatus,
  useOrderDocuments,
  useApproveOrderDocument,
  useRejectOrderDocument,
  useOrderDocumentDownloadUrl,
  useBookings,
  useDeliveryQuote,
  useMyOrders,
  useMyBookings,
} from './use-orders';
export {
  useCreateSellRequest,
  useSellRequests,
  // ---- trade-in queue (item 2.4) ----
  useSellRequestPage,
  useSellRequest,
  useQuoteSellRequest,
  useSetSellRequestStatus,
  useCreateSellAcceptToken,
  useAcceptSellRequest,
  useTradeInPayoutPage,
  useCreatePayoutForRequest,
  useRestockPayout,
} from './use-sell';
export { useOrderTracking } from './use-tracking';
export { queryKeys } from './query-keys';

// ---- admin (item 7) ----
export {
  useJobs,
  useJobPage,
  useJob,
  useCreateJob,
  useChangeJobStatus,
  useJobParts,
  useAddJobPart,
  useRecordJobPayment,
  useUpdateJob,
} from './use-jobs';
export {
  useAdminProducts,
  useLowStockProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useRestoreProduct,
  useAdjustStock,
  useLookupBarcode,
  useUploadProductImage,
  useDeleteProductImage,
  useUploadBuyInForm,
  useBuyInFormDownloadUrl,
  useProductVariants,
  useCreateProductVariant,
  useUpdateProductVariant,
  useDeleteProductVariant,
  useAdjustVariantStock,
  useReceiveVariantStock,
  useWriteOffVariantStock,
  useAdminCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from './use-inventory';
export {
  useAnalytics,
  useTransactions,
  useCashEntries,
  useCreateCashEntry,
  useShopDay,
  useDayCloses,
  useCreateDayClose,
  useRefunds,
  useCreateRefund,
  useTradeInPayouts,
  useCreateTradeInPayout,
} from './use-finance';
export {
  useTodaySummary,
  useTodayReport,
  useCompleteSale,
  useFavouriteProductIds,
  useToggleFavouriteProduct,
} from './use-pos';
export {
  useSession,
  useSignIn,
  useSignUp,
  useGoogleSignIn,
  useStaffSignIn,
  useRequestPasswordReset,
  useSignOut,
  useCustomerAddress,
  useSaveCustomerAddress,
  useAddressBook,
  useSaveAddressBookEntry,
  useSetDefaultAddressBookEntry,
  useDeleteAddressBookEntry,
  useLockSession,
  useUnlockSession,
  useSetStaffPin,
  useSetOwnIdleLock,
} from './use-auth';
export {
  usePromotions,
  usePromotionGroups,
  useSavePromotionGroup,
  useDeletePromotionGroup,
  useStaff,
  useCreateStaff,
  useUpdateStaff,
  useLabelTemplates,
  useSaveLabelTemplate,
  useDeleteLabelTemplate,
  useAdminReviews,
  useSaveReview,
  useDeleteReview,
  useProductReviews,
  useReviewEligibility,
  useSubmitProductReview,
  useAdminProductReviews,
  useApproveProductReview,
  useDeleteProductReview,
  useAdminDevices,
  useSaveDevice,
  useDeleteDevice,
  useAdminRepairTypes,
  useSaveRepairType,
  useDeleteRepairType,
  useSettings,
  useShopDetails,
  useUpdateSettings,
} from './use-admin-misc';
export { usePrintAgents, usePrintQueue, useResolvePrintJob, useEnqueuePrintJob } from './use-print';
