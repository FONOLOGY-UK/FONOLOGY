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

/** The confirmation page asks every 2 s, for up to a minute (30 asks), then stops. */
export const PAYMENT_STATUS_POLL_MS = 2_000;
export const PAYMENT_STATUS_GIVE_UP_MS = 60_000;

/**
 * Checkout confirmation: asks whether the order's payment has landed (the Stripe webhook marks
 * it paid, usually within seconds). Stops once it has, once the order turns out cancelled or
 * unknown, or after a minute.
 */
export function useOrderPaymentStatus(reference: string, intentId: string | null) {
  return useQuery({
    queryKey: queryKeys.orderPaymentStatus(reference, intentId ?? ''),
    queryFn: () => dataAdapter.getOrderPaymentStatus(reference, intentId!),
    enabled: reference.trim().length > 0 && !!intentId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data === null || data?.paid || data?.cancelled) return false;
      return query.state.dataUpdateCount * PAYMENT_STATUS_POLL_MS >= PAYMENT_STATUS_GIVE_UP_MS
        ? false
        : PAYMENT_STATUS_POLL_MS;
    },
  });
}
