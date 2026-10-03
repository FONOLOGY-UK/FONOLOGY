'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { AdminShopInput, Id } from '../types';
import { toast } from '@/lib/stores/toast.store';
import { queryKeys } from './query-keys';

/** The shops this member of staff can see — what the switcher, filters and pickers offer. */
export function useShops(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.shops,
    queryFn: () => dataAdapter.listShops(),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}

/** Owner only: every shop, closed ones included, with details. */
export function useAdminShops() {
  return useQuery({
    queryKey: queryKeys.adminShops,
    queryFn: () => dataAdapter.listAdminShops(),
  });
}

export function useSaveShop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminShopInput & { id?: Id }) => dataAdapter.saveShop(input),
    onSuccess: (shop, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminShops });
      queryClient.invalidateQueries({ queryKey: queryKeys.shops });
      toast(input.id ? `${shop.name} saved` : `${shop.name} added`);
    },
    onError: (error) => toast(error.message || 'Could not save the shop — try again.'),
  });
}
