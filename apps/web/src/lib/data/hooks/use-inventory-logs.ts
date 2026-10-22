'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type {
  BarcodeRegisterFilter,
  GoodsInProductInput,
  InventoryLogQuery,
  PageRequest,
  StockIntakeInput,
} from '../types';
import { queryKeys } from './query-keys';
import { toast } from '@/lib/stores/toast.store';

/**
 * The two inventory logs (0103 goods in, 0104 change log). Separate hooks, separate keys:
 * the two are never fetched or shown together.
 */

/**
 * Tester bug B-2: a delivery booked on a till never appeared in an admin Goods in page that was
 * already open — the app-wide cache keeps data a minute and never refetches on focus. The logs
 * are read on one screen and written on another (often another machine), so they are always
 * re-read on opening, on returning to the window, and every 30 seconds while open.
 */
const LIVE = { staleTime: 0, refetchOnWindowFocus: true, refetchInterval: 30_000 } as const;

const keys = {
  tillIntakes: ['stock-intakes', 'till'] as const,
  intakesPage: (q: InventoryLogQuery & PageRequest) => ['stock-intakes', 'page', q] as const,
  changesPage: (q: InventoryLogQuery & PageRequest) => ['inventory-changes', 'page', q] as const,
  toLink: ['stock-intakes', 'to-link'] as const,
  registerPage: (q: InventoryLogQuery & { status?: BarcodeRegisterFilter } & PageRequest) =>
    ['stock-intakes', 'register', q] as const,
};

/** Stock and barcodes moved: the catalogue the till and Inventory read is stale. */
function invalidateStock(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['stock-intakes'] });
  queryClient.invalidateQueries({ queryKey: ['inventory-changes'] });
  queryClient.invalidateQueries({ queryKey: queryKeys.adminProducts.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
}

/** The till's own recent deliveries. */
export function useTillStockIntakes() {
  return useQuery({
    queryKey: keys.tillIntakes,
    queryFn: () => dataAdapter.listTillStockIntakes(),
    ...LIVE,
  });
}

export function useCreateStockIntake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StockIntakeInput) => dataAdapter.createStockIntake(input),
    onSuccess: (intake) => {
      invalidateStock(queryClient);
      toast(`Booked in — ${intake.reference}`);
    },
    onError: (error) => toast(error.message || 'Could not book the delivery in — try again.'),
  });
}

/** The quick "new product" form on Goods in (client changes, Oct 2026 #8). */
export function useCreateGoodsInProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GoodsInProductInput) => dataAdapter.createGoodsInProduct(input),
    onSuccess: () => invalidateStock(queryClient),
  });
}

/** Barcodes from deliveries waiting for their product (0123). */
export function useToLinkBarcodes() {
  return useQuery({
    queryKey: keys.toLink,
    queryFn: () => dataAdapter.listToLinkBarcodes(),
    ...LIVE,
  });
}

export function useLinkToLinkBarcode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; productId: string; variantId?: string | null }) =>
      dataAdapter.linkToLinkBarcode(input.id, input.productId, input.variantId),
    onSuccess: () => {
      invalidateStock(queryClient);
      toast('Linked — the stock is added');
    },
  });
}

export function useDismissToLinkBarcode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dataAdapter.dismissToLinkBarcode(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stock-intakes'] }),
    onError: (error) => toast(error.message || 'Could not remove it — try again.'),
  });
}

/** The Goods in barcode register — the audit report. */
export function useRegisteredBarcodesPage(
  query: InventoryLogQuery & { status?: BarcodeRegisterFilter } & PageRequest,
) {
  return useQuery({
    queryKey: keys.registerPage(query),
    queryFn: () => dataAdapter.listRegisteredBarcodesPage(query),
    placeholderData: keepPreviousData,
    ...LIVE,
  });
}

export function useDownloadBarcodeRegisterPdf() {
  return useMutation({
    mutationFn: async (input: {
      query: InventoryLogQuery & { status?: BarcodeRegisterFilter };
      filename: string;
    }) => {
      const blob = await dataAdapter.downloadBarcodeRegisterPdf(input.query);
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

export function useStockIntakesPage(query: InventoryLogQuery & PageRequest) {
  return useQuery({
    queryKey: keys.intakesPage(query),
    queryFn: () => dataAdapter.listStockIntakesPage(query),
    placeholderData: keepPreviousData,
    ...LIVE,
  });
}

export function useInventoryChangesPage(query: InventoryLogQuery & PageRequest) {
  return useQuery({
    queryKey: keys.changesPage(query),
    queryFn: () => dataAdapter.listInventoryChangesPage(query),
    placeholderData: keepPreviousData,
    ...LIVE,
  });
}

/** Check / flag / clear one change-log entry (client changes, Oct 2026 #4). */
export function useReviewInventoryChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: 'checked' | 'flagged' | null }) =>
      dataAdapter.reviewInventoryChange(input.id, input.status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory-changes'] }),
    onError: (error) => toast(error.message || 'Could not save that — try again.'),
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
