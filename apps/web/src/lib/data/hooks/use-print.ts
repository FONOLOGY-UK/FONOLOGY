'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { Id, PrintEnqueueInput, PrintResolveOutcome } from '../types';
import { toast } from '@/lib/stores/toast.store';
import { queryKeys } from './query-keys';

/**
 * The print queue and the agents that drain it.
 *
 * WHY THESE POLL, AND WHY AT DIFFERENT RATES
 * This is a monitoring screen: the whole point is that it reflects the shop
 * RIGHT NOW, and an owner staring at a stale panel while nothing prints is
 * worse than no panel. But polling costs a round trip to Germany, so the two
 * queries are paced to how fast the thing behind them actually changes.
 *
 * The agent heartbeats every 30 seconds, so anything faster than that on the
 * agents query cannot show new information. The queue changes on staff action,
 * so it is checked a little more often.
 *
 * `refetchIntervalInBackground` is deliberately left off: a background tab must
 * not keep hitting the API all night.
 */

const AGENTS_POLL_MS = 30_000;
const QUEUE_POLL_MS = 15_000;

export function usePrintAgents() {
  return useQuery({
    queryKey: queryKeys.printAgents,
    queryFn: () => dataAdapter.listPrintAgents(),
    refetchInterval: AGENTS_POLL_MS,
  });
}

export function usePrintQueue(opts?: { attention?: boolean }) {
  const attention = opts?.attention ?? false;
  return useQuery({
    queryKey: queryKeys.printQueue(attention),
    queryFn: () => dataAdapter.listPrintQueue({ attention }),
    refetchInterval: QUEUE_POLL_MS,
  });
}

/**
 * A person answering the one question the system cannot: did paper come out?
 *
 * Both views are invalidated, not just the one on screen — the attention list
 * and the full list are two windows onto the same rows, and leaving one stale
 * means a job that was just resolved reappears when the filter is toggled.
 */
export function useResolvePrintJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, outcome }: { id: Id; outcome: PrintResolveOutcome }) =>
      dataAdapter.resolvePrintJob(id, outcome),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.printQueue(true) });
      queryClient.invalidateQueries({ queryKey: queryKeys.printQueue(false) });
      toast(
        variables.outcome === 'printed'
          ? 'Thanks — marked as printed.'
          : 'Sent to the printer again.',
      );
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Could not update that.'),
  });
}

/**
 * Ask for a piece of paper.
 *
 * A DUPLICATE IS NOT AN ERROR. The server returns the existing job for a
 * repeated `dedupeKey`, and the toast says so plainly rather than showing a
 * failure — pressing Print twice is a thing people do, and it must read as
 * "already done", not as something going wrong.
 */
export function useEnqueuePrintJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PrintEnqueueInput) => dataAdapter.enqueuePrintJob(input),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.printQueue(true) });
      queryClient.invalidateQueries({ queryKey: queryKeys.printQueue(false) });
      toast(result.duplicate ? 'Already sent to the printer.' : 'Sent to the printer.');
    },
    onError: (err) =>
      toast(err instanceof Error ? err.message : 'Could not send that to the printer.'),
  });
}
