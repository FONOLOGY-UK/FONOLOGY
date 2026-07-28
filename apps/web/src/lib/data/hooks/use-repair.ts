'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { BookingInput, PartTierId } from '../types';
import { queryKeys } from './query-keys';

const ALL_TIER_IDS: PartTierId[] = ['original', 'oem', 'copy'];

const FIVE_MIN = 5 * 60 * 1000;

/** Devices for the wizard's step 1. Rarely changes. */
export function useDevices() {
  return useQuery({
    queryKey: queryKeys.repair.devices,
    queryFn: () => dataAdapter.listDevices(),
    staleTime: FIVE_MIN,
  });
}

/** Repair problem types (step 2). */
export function useRepairTypes() {
  return useQuery({
    queryKey: queryKeys.repair.types,
    queryFn: () => dataAdapter.listRepairTypes(),
    staleTime: FIVE_MIN,
  });
}

/** Part grades (step 3). */
export function usePartTiers() {
  return useQuery({
    queryKey: queryKeys.repair.tiers,
    queryFn: () => dataAdapter.listPartTiers(),
    staleTime: FIVE_MIN,
  });
}

/** Derived quote for a full device+repair+tier selection. */
export function useRepairQuote(
  input: { deviceId?: string; repairId?: string; tierId?: PartTierId } | undefined,
) {
  const { deviceId, repairId, tierId } = input ?? {};
  return useQuery({
    queryKey: queryKeys.repair.quote(deviceId ?? '', repairId ?? '', tierId ?? ''),
    queryFn: () =>
      dataAdapter.getRepairQuote({
        deviceId: deviceId!,
        repairId: repairId!,
        tierId: tierId!,
      }),
    enabled: Boolean(deviceId && repairId && tierId),
  });
}

/**
 * Server-priced quotes for all three part tiers of one device+repair combo —
 * powers the step-3 tier grid. Prices always come from `repair_quote_price()`
 * server-side, never recomputed client-side. Returns null per tier while its
 * quote is loading or when the repair is diagnosis-only (server returns
 * price: null for those).
 */
export function useTierQuotes(deviceId?: string, repairId?: string) {
  const enabled = Boolean(deviceId && repairId);
  const results = useQueries({
    queries: ALL_TIER_IDS.map((tierId) => ({
      queryKey: queryKeys.repair.quote(deviceId ?? '', repairId ?? '', tierId),
      queryFn: () =>
        dataAdapter.getRepairQuote({ deviceId: deviceId!, repairId: repairId!, tierId }),
      enabled,
    })),
  });
  const prices: Record<PartTierId, number | null> = { original: null, oem: null, copy: null };
  results.forEach((r, i) => {
    prices[ALL_TIER_IDS[i]!] = r.data?.price ?? null;
  });
  return { prices, isLoading: results.some((r) => r.isLoading) };
}

/**
 * Server-priced "from" quotes (cheapest tier) for a list of repair types on
 * one device — powers the step-2 list's "from £X" hints without ever
 * recomputing pricing client-side.
 */
export function useFromQuotes(deviceId?: string, repairIds: string[] = []) {
  const enabled = Boolean(deviceId);
  const results = useQueries({
    queries: repairIds.map((repairId) => ({
      queryKey: queryKeys.repair.quote(deviceId ?? '', repairId, 'copy'),
      queryFn: () => dataAdapter.getRepairQuote({ deviceId: deviceId!, repairId, tierId: 'copy' }),
      enabled,
    })),
  });
  const prices: Record<string, number | null> = {};
  results.forEach((r, i) => {
    prices[repairIds[i]!] = r.data?.price ?? null;
  });
  return prices;
}

/** Submit the mail-in repair request (6.4). Invalidates the admin list. */
export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookingInput) => dataAdapter.createBooking(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.bookings.all });
    },
  });
}
