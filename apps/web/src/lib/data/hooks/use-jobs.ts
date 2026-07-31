'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type {
  Id,
  Job,
  JobInput,
  JobPartInput,
  JobPatch,
  JobPaymentInput,
  JobQuery,
  JobStatusChange,
} from '../types';
import { toast } from '@/lib/stores/toast.store';
import { queryKeys } from './query-keys';

/** The bench pipeline — every job, newest first. */
export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs.all,
    queryFn: () => dataAdapter.listJobs(),
  });
}

/**
 * The board's own query: filtered server-side, so a shop with two years of
 * finished jobs doesn't ship all of them to the browser to render six columns.
 */
export function useJobPage(query: JobQuery) {
  return useQuery({
    queryKey: queryKeys.jobs.page(query),
    queryFn: () => dataAdapter.listJobPage(query),
  });
}

export function useJob(id: Id | null) {
  return useQuery({
    queryKey: queryKeys.jobs.detail(id ?? ''),
    queryFn: () => dataAdapter.getJob(id!),
    enabled: id != null,
  });
}

/** Walk-in "Add job" at the counter. */
export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: JobInput) => dataAdapter.createJob(input),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast(`Job ${job.reference} on the bench`);
    },
    onError: (error) => toast(error.message || 'Could not add the job — try again.'),
  });
}

/**
 * A status move with its evidence.
 *
 * NOT optimistic, unlike the old `useUpdateJob`. Every one of these moves is
 * refused by the server under conditions the browser cannot check — the
 * transition trigger, a tracking number the courier rejected, a device already
 * cancelled by someone else at the counter. Painting the move on the board
 * first and rolling it back afterwards means the screen shows a device as
 * posted back when it is still on the shelf. A repair job board is a record of
 * where customers' property is; it waits for the answer.
 */
export function useChangeJobStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: Id; change: JobStatusChange }) =>
      dataAdapter.changeJobStatus(id, change),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      queryClient.setQueryData(queryKeys.jobs.detail(job.id), job);
    },
    onError: (error) => toast(error.message || 'That move didn’t save.'),
  });
}

/** Parts fitted to a job. */
export function useJobParts(id: Id | null) {
  return useQuery({
    queryKey: queryKeys.jobs.parts(id ?? ''),
    queryFn: () => dataAdapter.listJobParts(id!),
    enabled: id != null,
  });
}

/**
 * Fitting a part moves stock. The inventory queries are invalidated alongside
 * the job's, because the shelf count on the inventory screen has just changed
 * and a stale figure there is what gets a customer sold a part that's gone.
 */
export function useAddJobPart(jobId: Id | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: JobPartInput) => dataAdapter.addJobPart(jobId!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.parts(jobId ?? '') });
      queryClient.invalidateQueries({ queryKey: queryKeys.adminProducts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      toast('Part fitted — stock adjusted');
    },
    onError: (error) => toast(error.message || 'Could not add that part.'),
  });
}

/** Deposit or balance against a job. The server caps it at the job's price. */
export function useRecordJobPayment(jobId: Id | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: JobPaymentInput) => dataAdapter.recordJobPayment(jobId!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.detail(jobId ?? '') });
      toast('Payment recorded');
    },
    onError: (error) => toast(error.message || 'Could not record that payment.'),
  });
}

/**
 * Free-form field edits — retained for the detail panel's non-status changes.
 * Status moves go through `useChangeJobStatus`, which carries the evidence the
 * server demands; this must never be used to set `status`.
 */
export function useUpdateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: Id; patch: JobPatch }) => dataAdapter.updateJob(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.jobs.all });
      const previous = queryClient.getQueryData<Job[]>(queryKeys.jobs.all);
      queryClient.setQueryData<Job[]>(queryKeys.jobs.all, (jobs) =>
        jobs?.map((j) => (j.id === id ? { ...j, ...patch } : j)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.jobs.all, context.previous);
      toast(error.message || 'That change didn’t save — reverted.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all }),
  });
}
