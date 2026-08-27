'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { ProductQuery } from '../types';
import { queryKeys } from './query-keys';

/** Shop catalogue listing, filtered/sorted by the given query. */
export function useProducts(query?: ProductQuery) {
  return useQuery({
    queryKey: queryKeys.products.list(query),
    queryFn: () => dataAdapter.listProducts(query),
  });
}

/** A single product by slug (PDP). Returns null when not found. */
export function useProduct(slug: string) {
  return useQuery({
    queryKey: queryKeys.products.detail(slug),
    queryFn: () => dataAdapter.getProductBySlug(slug),
    enabled: slug.length > 0,
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
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) =>
      dataAdapter.checkProductAvailability(productId, quantity),
  });
}

/** Product category filters. */
export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => dataAdapter.listCategories(),
    staleTime: 5 * 60 * 1000, // categories rarely change
  });
}
