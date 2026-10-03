'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { PageRequest, TransactionsQuery } from '../types';

/**
 * Paged reads of the long lists. Each key starts with the same word as the list's old
 * "everything" key, so the many places that invalidate `['refunds']` or `['orders']` after a
 * change refresh these pages too. `keepPreviousData` keeps the current page on screen while the
 * next one loads, so paging and typing in the search box don't flash to a skeleton.
 */

export function useTransactionsPage(query: TransactionsQuery & PageRequest & { search?: string }) {
  return useQuery({
    queryKey: ['transactions', 'page', query] as const,
    queryFn: () => dataAdapter.listTransactionsPage(query),
    placeholderData: keepPreviousData,
  });
}

export function useRefundsPage(request: PageRequest & { search?: string }) {
  return useQuery({
    queryKey: ['refunds', 'page', request] as const,
    queryFn: () => dataAdapter.listRefundsPage(request),
    placeholderData: keepPreviousData,
  });
}

export function useCashEntriesPage(
  request: PageRequest & { date?: string; search?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: ['cash-entries', 'page', request] as const,
    queryFn: () => dataAdapter.listCashEntriesPage(request),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDayClosesPage(request: PageRequest) {
  return useQuery({
    queryKey: ['day-closes', 'page', request] as const,
    queryFn: () => dataAdapter.listDayClosesPage(request),
    placeholderData: keepPreviousData,
  });
}

export function useOrdersPage(
  query: PageRequest & {
    status?: string[];
    search?: string;
    from?: string;
    to?: string;
    sort?: 'oldest';
  },
  enabled = true,
) {
  return useQuery({
    queryKey: ['orders', 'page', query] as const,
    queryFn: () => dataAdapter.listOrdersPage(query),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useBookingsPage(query: PageRequest & { status?: string[]; search?: string }) {
  return useQuery({
    queryKey: ['bookings', 'page', query] as const,
    queryFn: () => dataAdapter.listBookingsPage(query),
    placeholderData: keepPreviousData,
  });
}
