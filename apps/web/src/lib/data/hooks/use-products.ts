'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { Category, Product, ProductQuery } from '../types';
import { queryKeys } from './query-keys';

/** Shop catalogue listing, filtered/sorted by the given query. */
export function useProducts(
  query?: ProductQuery,
  options?: { enabled?: boolean; initialData?: Product[] },
) {
  return useQuery({
    queryKey: queryKeys.products.list(query),
    queryFn: () => dataAdapter.listProducts(query),
    enabled: options?.enabled ?? true,
    initialData: options?.initialData,
  });
}

/**
 * Round 3 #4.1a: an imperative "can the bag hold N of this" check, fired at
 * the moment the customer tries to add/increment — a mutation rather than a
 * query on purpose (same reasoning as useLookupBarcode: this is a one-off
 * event, not cacheable screen state).
 */
export function useCheckProductAvailability() {
  return useMutation({
    mutationFn: ({
      productId,
      quantity,
      variantId,
    }: {
      productId: string;
      quantity: number;
      variantId?: string;
    }) => dataAdapter.checkProductAvailability(productId, quantity, variantId),
  });
}

/** Product category filters. */
export function useCategories(options?: { initialData?: Category[] }) {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => dataAdapter.listCategories(),
    staleTime: 5 * 60 * 1000, // categories rarely change
    initialData: options?.initialData,
  });
}
