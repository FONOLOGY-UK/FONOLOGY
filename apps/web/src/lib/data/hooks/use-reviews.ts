'use client';

import { useQuery } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import { queryKeys } from './query-keys';

/** Customer reviews for the storefront marquee. */
export function useReviews() {
  return useQuery({
    queryKey: queryKeys.reviews,
    queryFn: () => dataAdapter.listReviews(),
    staleTime: 5 * 60 * 1000,
  });
}
