'use client';

import { useQuery } from '@tanstack/react-query';
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

/** Product category filters. */
export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => dataAdapter.listCategories(),
    staleTime: 5 * 60 * 1000, // categories rarely change
  });
}
