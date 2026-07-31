'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type {
  Id,
  LabelTemplateInput,
  PromotionGroupInput,
  ShopSettingsPatch,
  StaffInput,
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

export function useStaff() {
  return useQuery({ queryKey: queryKeys.staff, queryFn: () => dataAdapter.listStaff() });
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

/* ---- Settings ------------------------------------------------------------- */

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => dataAdapter.getSettings(),
    staleTime: 60 * 1000,
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
