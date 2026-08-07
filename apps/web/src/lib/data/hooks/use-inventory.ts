'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { AdminProduct, Id, ProductInput } from '../types';
import { deriveStockStatus } from '../types';
import { toast } from '@/lib/stores/toast.store';
import { queryKeys } from './query-keys';

/** Admin catalogue with the private stock layer (counts, cost, supplier). */
export function useAdminProducts() {
  return useQuery({
    queryKey: queryKeys.adminProducts.all,
    queryFn: () => dataAdapter.listAdminProducts(),
  });
}

/**
 * Imperative barcode lookup for the scanner.
 *
 * A mutation rather than a query on purpose: a scan is an event, not a piece
 * of screen state. There is no key to subscribe to, the result is consumed
 * once, and caching a miss would mean a barcode that was just assigned to a
 * product kept reading as unknown.
 *
 * Deliberately no toast in here — a `null` result is a successful request
 * that found nothing, and only the calling screen knows how loudly that
 * needs saying (the till must shout; inventory just filters).
 */
export function useLookupBarcode() {
  return useMutation({
    mutationFn: (code: string) => dataAdapter.getProductByBarcode(code),
  });
}

function invalidateCatalogue(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: queryKeys.adminProducts.all });
  // The storefront reads the same catalogue — keep it honest after edits.
  queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) => dataAdapter.createProduct(input),
    onSuccess: (product) => {
      invalidateCatalogue(queryClient);
      toast(`${product.name} added to inventory`);
    },
    onError: (error) => toast(error.message || 'Could not add the product — try again.'),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: Id; input: ProductInput }) =>
      dataAdapter.updateProduct(id, input),
    onSuccess: (product) => {
      invalidateCatalogue(queryClient);
      toast(`${product.name} saved`);
    },
    onError: (error) => toast(error.message || 'Could not save the product — try again.'),
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.deleteProduct(id),
    onSuccess: () => {
      invalidateCatalogue(queryClient);
      toast('Product deleted');
    },
    onError: (error) => toast(error.message || 'Could not delete the product — try again.'),
  });
}

/** Inline +/- from the stock column — OPTIMISTIC, rolls back on failure. */
export function useAdjustStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, delta }: { id: Id; delta: number }) => dataAdapter.adjustStock(id, delta),
    onMutate: async ({ id, delta }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.adminProducts.all });
      const previous = queryClient.getQueryData<AdminProduct[]>(queryKeys.adminProducts.all);
      queryClient.setQueryData<AdminProduct[]>(queryKeys.adminProducts.all, (products) =>
        products?.map((p) => {
          if (p.id !== id) return p;
          const stockQty = Math.max(0, p.stockQty + delta);
          return {
            ...p,
            stockQty,
            stockStatus: deriveStockStatus(stockQty, p.stockStatus === 'restocking'),
          };
        }),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.adminProducts.all, context.previous);
      }
      toast(error.message || 'Stock change didn’t save — reverted.');
    },
    onSettled: () => invalidateCatalogue(queryClient),
  });
}
