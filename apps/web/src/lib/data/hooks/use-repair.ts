'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { BookingInput, PartTierId } from '../types';
import { queryKeys } from './query-keys';

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
