'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { Id, SaleInput } from '../types';
import { queryKeys } from './query-keys';

/** Today's sales total + count — the one figure employees may see. */
export function useTodaySummary() {
  return useQuery({
    queryKey: queryKeys.todaySummary,
    queryFn: () => dataAdapter.getTodaySummary(),
    refetchInterval: 60 * 1000, // the counter figure stays fresh through the day
  });
}

/**
 * Today's fuller picture for the employee day panel — still today ONLY.
 * Same `sales.today` permission; no history, no margins.
 */
export function useTodayReport() {
  return useQuery({
    queryKey: queryKeys.todayReport,
    queryFn: () => dataAdapter.getTodayReport(),
    refetchInterval: 60 * 1000,
  });
}

/**
 * Complete a counter sale. Errors carry the human reason (split mismatch
 * etc.) — the POS shows them inline, no toast. Success invalidates stock,
 * the ledger, analytics and today's figure in one sweep.
 */
export function useCompleteSale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaleInput) => dataAdapter.completeSale(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todaySummary });
      queryClient.invalidateQueries({ queryKey: queryKeys.todayReport });
      queryClient.invalidateQueries({ queryKey: queryKeys.adminProducts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

/**
 * Round 5 Phase 2 #3 — the caller's own pinned products. Per-account:
 * two different staff logins get two different lists, server-enforced.
 */
export function useFavouriteProductIds() {
  return useQuery({
    queryKey: queryKeys.favouriteProductIds,
    queryFn: () => dataAdapter.listFavouriteProductIds(),
  });
}

export function useToggleFavouriteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, pinned }: { productId: Id; pinned: boolean }) =>
      pinned
        ? dataAdapter.unpinFavouriteProduct(productId)
        : dataAdapter.pinFavouriteProduct(productId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.favouriteProductIds });
    },
  });
}
