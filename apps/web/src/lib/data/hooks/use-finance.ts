'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type {
  AnalyticsQuery,
  CashEntryInput,
  DayCloseInput,
  RefundInput,
  TradeInPayoutInput,
  TransactionsQuery,
} from '../types';
import { formatGBP } from '../types';
import { toast } from '@/lib/stores/toast.store';
import { queryKeys } from './query-keys';

/** Aggregated business summary for the dashboard/reports. */
export function useAnalytics(query: AnalyticsQuery) {
  return useQuery({
    queryKey: queryKeys.analytics(query),
    queryFn: () => dataAdapter.getAnalytics(query),
    placeholderData: (previous) => previous, // range changes keep the old chart up
  });
}

/** Settled payments ledger for a date range, newest first — optionally filtered by staff/tender. */
export function useTransactions(query: TransactionsQuery) {
  return useQuery({
    queryKey: queryKeys.transactions(query),
    queryFn: () => dataAdapter.listTransactions(query),
    placeholderData: (previous) => previous,
  });
}

export function useCashEntries() {
  return useQuery({
    queryKey: queryKeys.cashEntries,
    queryFn: () => dataAdapter.listCashEntries(),
  });
}

export function useCreateCashEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CashEntryInput) => dataAdapter.createCashEntry(input),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashEntries });
      toast(entry.kind === 'float-open' ? 'Opening float recorded' : 'Cash entry recorded');
    },
    onError: (error) => toast(error.message || 'Could not record that — try again.'),
  });
}

/**
 * The shop's trading day, from the server. Never `new Date()` — the browser
 * clock can be past midnight, or in another timezone, while the shop day is
 * still yesterday.
 */
export function useShopDay() {
  return useQuery({
    queryKey: queryKeys.shopDay,
    queryFn: () => dataAdapter.getShopDay(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDayCloses() {
  return useQuery({
    queryKey: queryKeys.dayCloses,
    queryFn: () => dataAdapter.listDayCloses(),
  });
}

/**
 * Close today's till. No toast on error: "already closed" is a normal thing
 * to hit (someone else closed it, or the page was left open), and the screen
 * says so in place rather than firing an alert at the operator.
 */
export function useCreateDayClose() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DayCloseInput) => dataAdapter.createDayClose(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dayCloses });
      queryClient.invalidateQueries({ queryKey: queryKeys.cashEntries });
    },
  });
}

export function useRefunds() {
  return useQuery({
    queryKey: queryKeys.refunds,
    queryFn: () => dataAdapter.listRefunds(),
  });
}

/** Errors here carry the business reason (unknown ref, over-amount, window). */
export function useCreateRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RefundInput) => dataAdapter.createRefund(input),
    onSuccess: (refund) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.refunds });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      // Restocking put items back on the shelf — the stock table is now stale.
      if (refund.restock) {
        queryClient.invalidateQueries({ queryKey: queryKeys.adminProducts.all });
      }
      toast(`Return recorded${refund.reference ? ` for ${refund.reference}` : ''}`);
    },
  });
}

/* ---- trade-ins / buy-ins -------------------------------------------------- */

export function useTradeInPayouts() {
  return useQuery({
    queryKey: queryKeys.tradeInPayouts,
    queryFn: () => dataAdapter.listTradeInPayouts(),
  });
}

/** Records money paid out for a device bought in — deducted from revenue. */
export function useCreateTradeInPayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TradeInPayoutInput) => dataAdapter.createTradeInPayout(input),
    onSuccess: (payout) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tradeInPayouts });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.todaySummary });
      toast(`${formatGBP(payout.amount)} paid out · ${payout.reference}`);
    },
    onError: (error) => toast(error.message || 'Could not record that — try again.'),
  });
}
