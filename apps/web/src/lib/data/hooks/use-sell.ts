'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { SellRequestInput } from '../types';
import { queryKeys } from './query-keys';

/** Submit a sell / trade-in request (6.5). Invalidates the admin list. */
export function useCreateSellRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SellRequestInput) => dataAdapter.createSellRequest(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.sellRequests.all });
    },
  });
}

/** Admin: list sell requests. */
export function useSellRequests() {
  return useQuery({
    queryKey: queryKeys.sellRequests.all,
    queryFn: () => dataAdapter.listSellRequests(),
  });
}
