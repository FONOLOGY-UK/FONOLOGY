'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type {
  Id,
  RestockInput,
  SellRequestInput,
  SellRequestQuery,
  SellStatus,
  TradeInPayoutInput,
  TradeInPayoutQuery,
} from '../types';
import { formatGBP, sellStatusLabel } from '../types';
import { toast } from '@/lib/stores/toast.store';
import { queryKeys } from './query-keys';

/** Submit a sell / trade-in request (6.5). Invalidates the admin list. */
export function useCreateSellRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SellRequestInput) => dataAdapter.createSellRequest(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.sellRequests.all });
    },
  });
}

/** Admin: list sell requests. */
export function useSellRequests() {
  return useQuery({
    queryKey: queryKeys.sellRequests.all,
    queryFn: () => dataAdapter.listSellRequests(),
  });
}

/* ---- staff trade-in queue -------------------------------------------------- */

/**
 * The queue, paginated and filtered. Filters arrive as props read from the URL
 * on the server page — deliberately not from `useSearchParams()`, which
 * suspends the component out of prerendering and left an earlier screen stuck
 * on skeletons forever with its query never registering.
 */
export function useSellRequestPage(query?: SellRequestQuery) {
  return useQuery({
    queryKey: queryKeys.sellRequests.page(query),
    queryFn: () => dataAdapter.listSellRequestPage(query),
    placeholderData: (previous) => previous,
  });
}

export function useSellRequest(id: Id | undefined) {
  return useQuery({
    queryKey: queryKeys.sellRequests.detail(id ?? ''),
    queryFn: () => dataAdapter.getSellRequest(id!),
    enabled: !!id,
  });
}

/** Everything that changes a request needs both the list and that row refreshed. */
function invalidateSell(qc: ReturnType<typeof useQueryClient>, id?: Id) {
  void qc.invalidateQueries({ queryKey: queryKeys.sellRequests.all });
  if (id) void qc.invalidateQueries({ queryKey: queryKeys.sellRequests.detail(id) });
}

/**
 * Records the quote. Only the amount is sent — who quoted it and when are the
 * server's, taken from the session, so the browser cannot attribute a quote to
 * someone else.
 */
export function useQuoteSellRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount }: { id: Id; amount: number }) =>
      dataAdapter.quoteSellRequest(id, amount),
    onSuccess: (request) => {
      invalidateSell(qc, request.id);
      toast(`Quoted ${formatGBP(request.quotedAmount ?? 0)}`);
    },
    onError: (error) => toast(error.message || 'Could not save the quote — try again.'),
  });
}

export function useSetSellRequestStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: Id; status: SellStatus }) =>
      dataAdapter.setSellRequestStatus(id, status),
    onSuccess: (request) => {
      invalidateSell(qc, request.id);
      toast(sellStatusLabel(request.status));
    },
    // The schema's own transition guard is what refuses an illegal move, and
    // it answers with a readable reason — show it rather than a generic one.
    onError: (error) => toast(error.message || 'That status change was refused.'),
  });
}

/**
 * Issues the customer's acceptance link.
 *
 * The plaintext token exists only in this response. It is returned to the
 * caller to display once and is never written to a query cache key, storage,
 * or a log — only its hash lives server-side, so it cannot be looked up again.
 */
export function useCreateSellAcceptToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.createSellAcceptToken(id),
    onSuccess: (_token, id) => invalidateSell(qc, id),
    onError: (error) => toast(error.message || 'Could not create the link — try again.'),
  });
}

/** Guest-facing redemption. No toast — the page renders the outcome itself. */
export function useAcceptSellRequest() {
  return useMutation({
    mutationFn: (token: string) => dataAdapter.acceptSellRequest(token),
  });
}

/* ---- payouts + restock ----------------------------------------------------- */

export function useTradeInPayoutPage(query?: TradeInPayoutQuery) {
  return useQuery({
    queryKey: queryKeys.tradeInPayoutPage(query),
    queryFn: () => dataAdapter.listTradeInPayoutPage(query),
    placeholderData: (previous) => previous,
  });
}

function invalidatePayouts(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.tradeInPayouts });
  void qc.invalidateQueries({ queryKey: ['trade-in-payout-page'] });
  // A payout is money out of the drawer, so today's figures move with it.
  // Prefix-matched: every date range of transactions is stale, not one.
  void qc.invalidateQueries({ queryKey: ['transactions'] });
}

/** Payout against a request. `amount` goes up positive; the server stores it negative. */
export function useCreatePayoutForRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: Id; input: TradeInPayoutInput }) =>
      dataAdapter.createTradeInPayoutFor(id, input),
    onSuccess: (payout, { id }) => {
      invalidatePayouts(qc);
      invalidateSell(qc, id);
      toast(`Paid out ${formatGBP(Math.abs(payout.amount))} — ${payout.reference}`);
    },
    onError: (error) => toast(error.message || 'Could not record the payout — try again.'),
  });
}

/**
 * Puts a bought device on the shelf. Never automatic: this only runs because
 * someone ticked the box and set a price. The cost recorded against the new
 * product is the payout amount, so the margin on the eventual sale is real.
 */
export function useRestockPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: Id; input: RestockInput }) =>
      dataAdapter.restockPayout(id, input),
    onSuccess: (product) => {
      invalidatePayouts(qc);
      void qc.invalidateQueries({ queryKey: queryKeys.adminProducts.all });
      toast(`“${product.name}” added to stock at ${formatGBP(product.price)}`);
    },
    onError: (error) => toast(error.message || 'Could not add it to stock — try again.'),
  });
}
