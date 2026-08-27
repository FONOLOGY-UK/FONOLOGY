'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { AdminProduct, CategoryInput, Id, ProductInput } from '../types';
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
 * Active, alert-on, still-in-stock products at/below their own threshold —
 * server-computed (0043's `low_stock_products` view in http mode), so this is
 * the one to use for "how many are low right now", not a client-side filter
 * over `useAdminProducts()` (which includes retired products and has no
 * reason to agree with the DB's definition of "low").
 */
export function useLowStockProducts() {
  return useQuery({
    queryKey: queryKeys.lowStockProducts.all,
    queryFn: () => dataAdapter.listLowStockProducts(),
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

/**
 * One product photo, uploaded and returned as a real URL — no toast here on
 * purpose: the calling field shows its own inline uploading/done/failed
 * state per file (several may be in flight at once), which a single global
 * toast per upload would just be noise on top of.
 *
 * BUG-15: several files are genuinely in flight at once from ONE call to
 * this hook (the dialog fires it once per file in a batch), so the caller
 * MUST drive it through `mutateAsync(file)` — awaited or `.then()`-chained
 * per call — never `mutate(file, { onSuccess, onError })`. TanStack Query's
 * `MutationObserver` keeps a single `#mutateOptions` field per hook
 * instance, overwritten on every `mutate()` call; with several calls in
 * flight at once on the same hook instance, only the LAST one issued can
 * ever have its onSuccess/onError actually fire — every earlier upload
 * still completes on the server but never tells the UI, which is exactly
 * how "image 2 of 2" got stuck at "Uploading…" forever. `mutateAsync`
 * doesn't go through that shared field at all — it returns the promise
 * from that call's own underlying mutation, so each call's outcome is
 * tracked independently regardless of how many are in flight together.
 */
export function useUploadProductImage() {
  return useMutation({
    mutationFn: (file: File) => dataAdapter.uploadProductImage(file),
  });
}

/** Cleanup for a photo that never ended up attached to a saved product — see
 * `deleteProductImage` on the adapter. Fire-and-forget from the caller's
 * side; a failure here just leaves the pre-existing behaviour (an orphaned
 * file), not a new one, so nothing needs to await or retry it. */
export function useDeleteProductImage() {
  return useMutation({
    mutationFn: (url: string) => dataAdapter.deleteProductImage(url),
  });
}

function invalidateCatalogue(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: queryKeys.adminProducts.all });
  // The storefront reads the same catalogue — keep it honest after edits.
  queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
  // Stock/threshold/alert/retire edits all change who counts as low-stock.
  queryClient.invalidateQueries({ queryKey: queryKeys.lowStockProducts.all });
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

/** Round 4 #BUG-10 — the undo for useDeleteProduct. */
export function useRestoreProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.restoreProduct(id),
    onSuccess: (product) => {
      invalidateCatalogue(queryClient);
      toast(`${product.name} restored`);
    },
    onError: (error) => toast(error.message || 'Could not restore the product — try again.'),
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

/* ---- Categories (FEATURE-05) ---------------------------------------------- */

/** Admin's-eye view of every category — real rows with id/parentId, for the categories management screen and the product/restock category pickers. */
export function useAdminCategories() {
  return useQuery({
    queryKey: queryKeys.adminCategories.all,
    queryFn: () => dataAdapter.listAdminCategories(),
  });
}

function invalidateCategories(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: queryKeys.adminCategories.all });
  // The storefront's flat filter list and every product row's display slug
  // both derive from the same table — keep them honest after an edit.
  queryClient.invalidateQueries({ queryKey: queryKeys.categories });
  invalidateCatalogue(queryClient);
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CategoryInput) => dataAdapter.createCategory(input),
    onSuccess: (category) => {
      invalidateCategories(queryClient);
      toast(`${category.label} added`);
    },
    onError: (error) => toast(error.message || 'Could not add the category — try again.'),
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: Id; input: CategoryInput }) =>
      dataAdapter.updateCategory(id, input),
    onSuccess: (category) => {
      invalidateCategories(queryClient);
      toast(`${category.label} saved`);
    },
    onError: (error) => toast(error.message || 'Could not save the category — try again.'),
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => dataAdapter.deleteCategory(id),
    onSuccess: () => {
      invalidateCategories(queryClient);
      toast('Category deleted');
    },
    // Surfaces the 409 ("still has products/subcategories under it") from
    // the server as-is — the message is already written for a person.
    onError: (error) => toast(error.message || 'Could not delete the category — try again.'),
  });
}
