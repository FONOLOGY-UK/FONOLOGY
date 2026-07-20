'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { SaleInput } from '../types';
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
      queryClient.invalidateQueries({ queryKey: queryKeys.adminProducts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}
