'use client';

import { useQuery } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import { queryKeys } from './query-keys';

/**
 * Resolve a reference to a booking or an order for the public /track page.
 * Both reference and email are required — a reference alone must never
 * return someone's order/booking details (references are sequential and
 * guessable).
 */
export function useTracking(reference: string, email: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.tracking(reference, email),
    queryFn: () => dataAdapter.getTracking(reference, email),
    enabled: enabled && reference.trim().length > 0 && email.trim().length > 0,
  });
}
