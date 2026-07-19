'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type {
  Id,
  LabelTemplateInput,
  PromotionInput,
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

export function useCreatePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PromotionInput) => dataAdapter.createPromotion(input),
    onSuccess: (promotion) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.promotions.all });
      toast(`“${promotion.name}” created`);
    },
    onError: (error) => toast(error.message || 'Could not create the promotion — try again.'),
  });
}

export function useUpdatePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: Id; input: PromotionInput }) =>
      dataAdapter.updatePromotion(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.promotions.all }),
    onError: (error) => toast(error.message || 'Could not save the promotion — try again.'),
  });
}

export function useDeletePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.deletePromotion(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.promotions.all });
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
