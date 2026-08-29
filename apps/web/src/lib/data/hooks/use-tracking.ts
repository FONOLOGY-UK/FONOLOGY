'use client';

import { useQuery } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import { queryKeys } from './query-keys';

/**
 * Round 5 Phase 3 #23 — the /track page, Order ID only, no email. Returns
 * courier + tracking number only; `null` for an unknown reference. See
 * getOrderTracking's own comment (adapters/types.ts) for why this is
 * deliberately this narrow.
 */
export function useOrderTracking(reference: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.orderTracking(reference),
    queryFn: () => dataAdapter.getOrderTracking(reference),
    enabled: enabled && reference.trim().length > 0,
  });
}
