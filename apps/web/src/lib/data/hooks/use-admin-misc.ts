'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type {
  AdminDelivery,
  AdminDeviceInput,
  AdminRepairTypeInput,
  AdminReviewInput,
  ProductReviewInput,
  Id,
  LabelTemplateInput,
  PromotionGroupInput,
  ShopSettingsPatch,
  StaffInput,
  RepairSubTypeInput,
} from '../types';
import { toast } from '@/lib/stores/toast.store';
import { queryKeys } from './query-keys';

/* ---- Promotions ----------------------------------------------------------- */

export function usePromotions() {
  return useQuery({
    queryKey: queryKeys.promotions.all,
    queryFn: () => dataAdapter.listPromotions(),
  });
}

/** One entry per offer — what the admin screen lists. */
export function usePromotionGroups() {
  return useQuery({
    queryKey: queryKeys.promotionGroups.all,
    queryFn: () => dataAdapter.listPromotionGroups(),
  });
}

/**
 * Both halves of the list have to be refreshed after any write: the grouped
 * view the admin screen reads, and the flat view the till prices from. They
 * are two views of the same rows, so one going stale would put the counter on
 * old prices.
 */
function invalidatePromotions(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: queryKeys.promotionGroups.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.promotions.all });
}

/** Create or replace, in one transaction. `groupId` present = replace. */
export function useSavePromotionGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PromotionGroupInput) => dataAdapter.savePromotionGroup(input),
    onSuccess: (group, input) => {
      invalidatePromotions(queryClient);
      toast(input.groupId ? `“${group.name}” saved` : `“${group.name}” created`);
      const skippedShops = new Set((group.skipped ?? []).map((s) => s.shopId));
      if (skippedShops.size > 0) {
        toast(
          `${skippedShops.size === 1 ? 'One shop doesn’t' : `${skippedShops.size} shops don’t`} stock some of these products, so the offer doesn’t apply there.`,
        );
      }
    },
    // The API's messages are written to be read by a shop owner — the tier and
    // product guards all raise readable text — so show it rather than bury it.
    onError: (error) => toast(error.message || 'Could not save the promotion — try again.'),
  });
}

export function useDeletePromotionGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: Id) => dataAdapter.deletePromotionGroup(groupId),
    onSuccess: () => {
      invalidatePromotions(queryClient);
      toast('Promotion deleted');
    },
    onError: (error) => toast(error.message || 'Could not delete the promotion — try again.'),
  });
}

/* ---- Staff ---------------------------------------------------------------- */

/**
 * `GET /admin/staff` requires `staff.manage`. Counter staff do not hold it, so
 * for them this request can only ever be refused — pass `enabled: false` rather
 * than firing it and discarding a 403. See the float prompt, which needs the
 * list only to name who counted the float and has a fallback when it cannot.
 */
export function useStaff(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.staff,
    queryFn: () => dataAdapter.listStaff(),
    enabled: options?.enabled ?? true,
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StaffInput) => dataAdapter.createStaff(input),
    onSuccess: (member) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.staff });
      toast(`${member.name} added to the team`);
    },
    onError: (error) => toast(error.message || 'Could not add the staff member — try again.'),
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: Id; input: StaffInput }) =>
      dataAdapter.updateStaff(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.staff }),
    onError: (error) => toast(error.message || 'Could not save that change — try again.'),
  });
}

/* ---- Label templates ------------------------------------------------------ */

export function useLabelTemplates() {
  return useQuery({
    queryKey: queryKeys.labelTemplates,
    queryFn: () => dataAdapter.listLabelTemplates(),
  });
}

export function useSaveLabelTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LabelTemplateInput & { id?: Id }) => dataAdapter.saveLabelTemplate(input),
    onSuccess: (template) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.labelTemplates });
      toast(`“${template.name}” saved`);
    },
    onError: (error) => toast(error.message || 'Could not save the template — try again.'),
  });
}

export function useDeleteLabelTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.deleteLabelTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.labelTemplates });
      toast('Template deleted');
    },
    onError: (error) => toast(error.message || 'Could not delete the template — try again.'),
  });
}

/* ---- Reviews (admin) -------------------------------------------------------- */
// Round 3 follow-up #4. Separate query key from `queryKeys.reviews` (the
// public, storefront-facing list) — this one includes unpublished rows and
// is gated on reviews.manage, so it must never be the cache a logged-out
// visitor's homepage read could share.

export function useAdminReviews() {
  return useQuery({
    queryKey: queryKeys.adminReviews,
    queryFn: () => dataAdapter.listAdminReviews(),
  });
}

export function useSaveReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminReviewInput & { id?: Id }) => dataAdapter.saveReview(input),
    onSuccess: (review, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminReviews });
      // The public homepage list is a different cache (published-only) —
      // invalidate it too so a publish/unpublish or edit shows up there
      // without staff having to know to reload a different page.
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
      toast(input.id ? `Review by “${review.name}” saved` : `Review by “${review.name}” added`);
    },
    onError: (error) => toast(error.message || 'Could not save the review — try again.'),
  });
}

export function useDeleteReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.deleteReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminReviews });
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
      toast('Review deleted');
    },
    onError: (error) => toast(error.message || 'Could not delete the review — try again.'),
  });
}

/* ---- Product reviews (Round 5 Phase 4 #21) ---------------------------------- */
// DELIBERATELY separate from the reviews (testimonials) hooks above — see
// 0062_product_reviews.sql / review.ts's own comments on why.

/** Approved reviews on one product's own page — public. */
export function useProductReviews(productId: Id, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.productReviews(productId),
    queryFn: () => dataAdapter.listProductReviews(productId),
    enabled: enabled && productId.length > 0,
  });
}

/** Signed-in only — whether this customer may submit a review here, or
 * already has one. Caller passes `enabled: session?.kind === 'customer'`. */
export function useReviewEligibility(productId: Id, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.reviewEligibility(productId),
    queryFn: () => dataAdapter.getReviewEligibility(productId),
    enabled: enabled && productId.length > 0,
  });
}

export function useSubmitProductReview(productId: Id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductReviewInput) => dataAdapter.submitProductReview(productId, input),
    onSuccess: () => {
      // Not the reviews list — a fresh submission is pending, never shown
      // publicly yet. Only the eligibility check (which now shows "pending
      // approval") needs to change immediately.
      queryClient.invalidateQueries({ queryKey: queryKeys.reviewEligibility(productId) });
      toast('Thanks — your review is pending approval');
    },
    onError: (error) => toast(error.message || 'Could not submit your review — try again.'),
  });
}

export function useAdminProductReviews(status?: 'pending' | 'approved') {
  return useQuery({
    queryKey: queryKeys.adminProductReviews(status),
    queryFn: () => dataAdapter.listAdminProductReviews(status),
  });
}

function invalidateProductReviews(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['admin-product-reviews'] });
  queryClient.invalidateQueries({ queryKey: ['product-reviews'] });
}

export function useApproveProductReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.approveProductReview(id),
    onSuccess: () => {
      invalidateProductReviews(queryClient);
      toast('Review approved');
    },
    onError: (error) => toast(error.message || 'Could not approve the review — try again.'),
  });
}

export function useDeleteProductReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.deleteProductReview(id),
    onSuccess: () => {
      invalidateProductReviews(queryClient);
      toast('Review deleted');
    },
    onError: (error) => toast(error.message || 'Could not delete the review — try again.'),
  });
}

/* ---- Device models (admin) -------------------------------------------------- */
// Round 4 #FEAT-01. Same shape as reviews above: `queryKeys.repair.devices`
// is the public, active-only list Repair/Sell-In actually render from —
// invalidating it alongside the admin one is what makes an add/edit/remove
// here show up in both customer-facing dropdowns immediately, without
// either of them needing to know this admin screen exists.

export function useAdminDevices() {
  return useQuery({
    queryKey: queryKeys.adminDevices,
    queryFn: () => dataAdapter.listAdminDevices(),
  });
}

function invalidateDevices(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: queryKeys.adminDevices });
  queryClient.invalidateQueries({ queryKey: queryKeys.repair.devices });
  // A device's prices are saved with it (0109): its offers change too.
  queryClient.invalidateQueries({ queryKey: ['repair', 'offers'] });
  queryClient.invalidateQueries({ queryKey: ['admin-device-prices'] });
}

export function useSaveDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminDeviceInput & { id?: Id }) => dataAdapter.saveDevice(input),
    onSuccess: (device, input) => {
      invalidateDevices(queryClient);
      toast(input.id ? `“${device.name}” saved` : `“${device.name}” added`);
    },
    onError: (error) => toast(error.message || 'Could not save the device — try again.'),
  });
}

export function useDeleteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.deleteDevice(id),
    onSuccess: () => {
      invalidateDevices(queryClient);
      toast('Device removed');
    },
    onError: (error) => toast(error.message || 'Could not remove the device — try again.'),
  });
}

/* ---- Repair types (admin) --------------------------------------------------- */
// Round 5 #33 (admin half). Same shape as devices above: `queryKeys.repair.types`
// is the public, active-only list /repair actually renders from — invalidating
// it alongside the admin one is what makes an add/edit/remove here show up in
// the customer-facing repair form immediately.

export function useAdminRepairTypes() {
  return useQuery({
    queryKey: queryKeys.adminRepairTypes,
    queryFn: () => dataAdapter.listAdminRepairTypes(),
  });
}

function invalidateRepairTypes(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: queryKeys.adminRepairTypes });
  queryClient.invalidateQueries({ queryKey: queryKeys.repair.types });
  queryClient.invalidateQueries({ queryKey: ['repair', 'offers'] });
  queryClient.invalidateQueries({ queryKey: ['admin-device-prices'] });
}

export function useSaveRepairType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminRepairTypeInput & { id?: Id }) => dataAdapter.saveRepairType(input),
    onSuccess: (repairType, input) => {
      invalidateRepairTypes(queryClient);
      toast(input.id ? `“${repairType.name}” saved` : `“${repairType.name}” added`);
    },
    onError: (error) => toast(error.message || 'Could not save the repair type — try again.'),
  });
}

export function useDeleteRepairType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.deleteRepairType(id),
    onSuccess: () => {
      invalidateRepairTypes(queryClient);
      toast('Repair type removed');
    },
    onError: (error) => toast(error.message || 'Could not remove the repair type — try again.'),
  });
}

/* ---- Device prices and repair sub-types (0109, tester change C-3) --------------------------- */

/** One device's repair price list — the edit form, and "Duplicate pricing from existing device". */
export function useDevicePrices(deviceId: Id | null | undefined) {
  return useQuery({
    queryKey: queryKeys.devicePrices(deviceId ?? ''),
    queryFn: () => dataAdapter.getDevicePrices(deviceId!),
    enabled: Boolean(deviceId),
    staleTime: 0,
  });
}

export function useAdminRepairSubTypes() {
  return useQuery({
    queryKey: queryKeys.adminRepairSubTypes,
    queryFn: () => dataAdapter.listAdminRepairSubTypes(),
  });
}

/** Sub-types and prices feed every device's offers: refresh all of it after a change. */
function invalidateRepairCatalogue(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: queryKeys.adminRepairSubTypes });
  queryClient.invalidateQueries({ queryKey: queryKeys.repair.subTypes });
  queryClient.invalidateQueries({ queryKey: queryKeys.adminRepairTypes });
  queryClient.invalidateQueries({ queryKey: queryKeys.repair.types });
  queryClient.invalidateQueries({ queryKey: ['repair', 'offers'] });
  queryClient.invalidateQueries({ queryKey: ['admin-device-prices'] });
}

export function useSaveRepairSubType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RepairSubTypeInput & { id?: Id }) => dataAdapter.saveRepairSubType(input),
    onSuccess: (subType, input) => {
      invalidateRepairCatalogue(queryClient);
      toast(input.id ? `“${subType.name}” saved` : `“${subType.name}” added`);
    },
    onError: (error) => toast(error.message || 'Could not save the sub-type — try again.'),
  });
}

export function useDeleteRepairSubType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.deleteRepairSubType(id),
    onSuccess: () => {
      invalidateRepairCatalogue(queryClient);
      toast('Sub-type deleted');
    },
    onError: (error) => toast(error.message || 'Could not delete the sub-type — try again.'),
  });
}

/* ---- Delivery (0102) ------------------------------------------------------ */

export function useAdminDelivery() {
  return useQuery({
    queryKey: queryKeys.adminDelivery,
    queryFn: () => dataAdapter.getAdminDelivery(),
  });
}

/**
 * Every delivery write answers with the whole screen, so the cache is set from the response.
 * The storefront's shop details (banner, 'from £x') and any open quote are invalidated too.
 */
function useDeliveryWrite<T>(fn: (input: T) => Promise<AdminDelivery>, done: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.adminDelivery, data);
      queryClient.invalidateQueries({ queryKey: queryKeys.shopDetails });
      queryClient.invalidateQueries({ queryKey: ['orders', 'delivery-quote'] });
      toast(done);
    },
    onError: (error) => toast(error.message || 'Could not save delivery settings — try again.'),
  });
}

export function useUpdateFreeDeliveryThreshold() {
  return useDeliveryWrite(
    (pence: number) => dataAdapter.updateFreeDeliveryThreshold(pence),
    'Free-delivery threshold saved',
  );
}

export function useSaveDeliveryRate() {
  return useDeliveryWrite(
    (input: { id: Id; price: number; available: boolean }) =>
      dataAdapter.saveDeliveryRate(input.id, { price: input.price, available: input.available }),
    'Delivery rate saved',
  );
}

export function useAddDeliveryPrefix() {
  return useDeliveryWrite(
    (input: { prefix: string; zoneId: Id }) => dataAdapter.addDeliveryPrefix(input),
    'Postcode added',
  );
}

export function useRemoveDeliveryPrefix() {
  return useDeliveryWrite(
    (prefix: string) => dataAdapter.removeDeliveryPrefix(prefix),
    'Postcode removed',
  );
}

/* ---- Settings ------------------------------------------------------------- */

/**
 * `GET /admin/settings` requires `settings.manage` — see the note below and
 * receipt.tsx, which hit this same wall. `enabled` lets a surface that renders
 * for BOTH owners and counter staff (the till shell) ask only when the person
 * looking can actually be answered.
 */
export function useSettings(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => dataAdapter.getSettings(),
    staleTime: 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * PUBLIC shop details — safe to call from ANY surface.
 *
 * Prefer this over `useSettings()` for anything a customer or a counter staff
 * member sees. `useSettings()` hits `GET /admin/settings`, which requires the
 * `settings.manage` permission that only owners hold — so on the till it
 * fails silently and every value reads as undefined. That is exactly how the
 * receipt ended up printing no returns line for the only people who print
 * receipts.
 *
 * Long staleTime: these change about twice a year.
 */
export function useShopDetails() {
  return useQuery({
    queryKey: queryKeys.shopDetails,
    queryFn: () => dataAdapter.getShopDetails(),
    staleTime: 60 * 60 * 1000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ShopSettingsPatch) => dataAdapter.updateSettings(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      toast('Settings saved');
    },
    onError: (error) => toast(error.message || 'Could not save settings — try again.'),
  });
}
