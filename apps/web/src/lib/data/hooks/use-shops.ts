'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { AdminShopInput, AnalyticsQuery, Id } from '../types';
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

/** The master list for the picker. `enabled` keeps it from loading until the dialog is open. */
export function useMasterProducts(query: { search?: string; barcode?: string }, enabled = true) {
  return useQuery({
    queryKey: ['master-products', query.search ?? '', query.barcode ?? ''],
    queryFn: () => dataAdapter.listMasterProducts(query),
    enabled,
  });
}

/** Copy a master product into this shop. Refreshes the inventory the new copy lands in. */
export function useCopyMasterProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (masterId: Id) => dataAdapter.copyMasterProduct(masterId),
    onSuccess: (product) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminProducts.all });
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
      toast(`${product.name} added to your shop — set your price and stock`);
    },
    onError: (error) => toast(error.message || 'Could not add that product — try again.'),
  });
}

/** The side-by-side shop report for a range. `enabled` keeps employees (who can't) from asking. */
export function useShopComparison(query: AnalyticsQuery, enabled: boolean) {
  return useQuery({
    queryKey: ['shop-comparison', query.from, query.to],
    queryFn: () => dataAdapter.getShopComparison(query),
    enabled,
    placeholderData: (previous) => previous,
  });
}
