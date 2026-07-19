'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { Id, Job, JobInput, JobPatch } from '../types';
import { toast } from '@/lib/stores/toast.store';
import { queryKeys } from './query-keys';

/** The bench pipeline — every job, newest first. */
export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs.all,
    queryFn: () => dataAdapter.listJobs(),
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
 * Status moves / payment / edits — OPTIMISTIC. The board updates instantly;
 * on failure it rolls back and says so (speed first, but honestly).
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
