'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { BookingInput } from '../types';
import { queryKeys } from './query-keys';
import { toast } from '@/lib/stores/toast.store';

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

/**
 * Change request item 2 — which details each repair type needs at intake.
 *
 * Staff-only, and its own query rather than a field on useRepairTypes():
 * that one reads the PUBLIC endpoint the storefront's repair wizard uses.
 * Same five-minute staleTime as the rest of the catalogue — this is
 * configuration, not live state.
 */
export function useRepairConversionFields() {
  return useQuery({
    queryKey: queryKeys.repair.conversionFields,
    queryFn: () => dataAdapter.listRepairConversionFields(),
    staleTime: FIVE_MIN,
  });
}

/** The grades a repair comes in (step 3) — Original, OEM, Copy, custom ones (0109). */
export function useRepairSubTypes() {
  return useQuery({
    queryKey: queryKeys.repair.subTypes,
    queryFn: () => dataAdapter.listRepairSubTypes(),
    staleTime: FIVE_MIN,
  });
}

/**
 * What one device can be repaired for, and at what price (0109). Only what
 * that device offers — a repair or grade with no price on it is absent, so it appears nowhere for
 * that device. Prices always come from the server; nothing is computed in the browser.
 */
export function useRepairOffers(deviceId?: string | null) {
  return useQuery({
    queryKey: queryKeys.repair.offers(deviceId ?? ''),
    queryFn: () => dataAdapter.listRepairOffers(deviceId!),
    enabled: Boolean(deviceId),
    staleTime: 60 * 1000,
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

/**
 * Change request item 2 — send a repair request to the bench.
 *
 * Invalidates bookings AND jobs: the request's status moves and a new job
 * appears, and the submissions list derives "already claimed" from the jobs
 * it holds. Leaving either stale shows a converted request as still waiting.
 */
export function useConvertBookingToJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      bookingId,
      quotedPrice,
      intakeDetails,
      smsUpdates,
    }: {
      bookingId: string;
      quotedPrice?: number | null;
      intakeDetails?: Record<string, string>;
      smsUpdates?: boolean;
    }) => dataAdapter.convertBookingToJob(bookingId, { quotedPrice, intakeDetails, smsUpdates }),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast(`On the bench as ${job.reference}.`);
    },
    onError: (err) =>
      toast(err instanceof Error ? err.message : 'Could not send that to the bench.'),
  });
}
