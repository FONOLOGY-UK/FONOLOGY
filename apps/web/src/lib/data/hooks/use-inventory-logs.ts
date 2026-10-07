'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { InventoryLogQuery, PageRequest, StockIntakeInput } from '../types';
import { toast } from '@/lib/stores/toast.store';

/**
 * The two inventory logs (0103 goods in, 0104 change log). Separate hooks, separate keys:
 * the two are never fetched or shown together.
 */

const keys = {
  tillIntakes: ['stock-intakes', 'till'] as const,
  intakesPage: (q: InventoryLogQuery & PageRequest) => ['stock-intakes', 'page', q] as const,
  changesPage: (q: InventoryLogQuery & PageRequest) => ['inventory-changes', 'page', q] as const,
};

/** The till's own recent deliveries. */
export function useTillStockIntakes() {
  return useQuery({
    queryKey: keys.tillIntakes,
    queryFn: () => dataAdapter.listTillStockIntakes(),
  });
}

export function useCreateStockIntake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StockIntakeInput) => dataAdapter.createStockIntake(input),
    onSuccess: (intake) => {
      queryClient.invalidateQueries({ queryKey: ['stock-intakes'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-changes'] });
      // Stock counts moved.
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast(`Booked in — ${intake.reference}`);
    },
    onError: (error) => toast(error.message || 'Could not book the delivery in — try again.'),
  });
}

export function useStockIntakesPage(query: InventoryLogQuery & PageRequest) {
  return useQuery({
    queryKey: keys.intakesPage(query),
    queryFn: () => dataAdapter.listStockIntakesPage(query),
    placeholderData: keepPreviousData,
  });
}

export function useInventoryChangesPage(query: InventoryLogQuery & PageRequest) {
  return useQuery({
    queryKey: keys.changesPage(query),
    queryFn: () => dataAdapter.listInventoryChangesPage(query),
    placeholderData: keepPreviousData,
  });
}

/** Downloads one log as a PDF, filtered as its page is. */
export function useDownloadInventoryLogPdf() {
  return useMutation({
    mutationFn: async (input: {
      log: 'goods-in' | 'changes';
      query: InventoryLogQuery;
      filename: string;
    }) => {
      const blob = await dataAdapter.downloadInventoryLogPdf(input.log, input.query);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = input.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    onError: (error) => toast(error.message || 'Could not make the PDF — try again.'),
  });
}
