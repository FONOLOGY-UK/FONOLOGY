'use client';

import { useQuery } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import { queryKeys } from './query-keys';

/** Resolve a reference to a booking or order for the public /track page. */
export function useTracking(reference: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.tracking(reference),
    queryFn: () => dataAdapter.getTracking(reference),
    enabled: enabled && reference.trim().length > 0,
  });
}
