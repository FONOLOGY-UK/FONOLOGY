'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { OrderStatus, OrderInput, DeliveryQuoteInput, CartLine } from '../types';
import { toast } from '@/lib/stores/toast.store';
import { queryKeys } from './query-keys';

/**
 * The real, postcode-derived delivery fee for the current basket/method —
 * always what create_order would actually charge (see delivery_quote() /
 * 0021_delivery_quote.sql). Refetches whenever the basket, method or
 * postcode changes; an empty/unrecognised postcode still resolves (falls
 * back to the standard zone server-side), so this is safe to call before
 * the customer has finished typing.
 */
export function useDeliveryQuote(
  lines: CartLine[],
  delivery: DeliveryQuoteInput['delivery'],
  postcode: string,
) {
  const linesKey = lines.map((l) => `${l.productId}:${l.quantity}`).join(',');
  return useQuery({
    queryKey: queryKeys.orders.deliveryQuote(linesKey, delivery, postcode),
    queryFn: () =>
      dataAdapter.getDeliveryQuote({ lines, delivery, postcode: postcode || undefined }),
    enabled: lines.length > 0,
    placeholderData: (previous) => previous,
  });
}

/**
 * Uploads one number-plate verification document, returning its storage key
 * (audit finding CRIT-02).
 *
 * A mutation per document rather than one call for both: they are chosen in
 * two separate file inputs at different moments, and one failing must not
 * discard the other that already succeeded.
 */
export function useUploadOrderDocument() {
  return useMutation({
    mutationFn: ({ kind, file }: { kind: 'v5c' | 'driving_licence'; file: File }) =>
      dataAdapter.uploadOrderDocument(kind, file),
  });
}

/** Create an order at checkout. Invalidates the admin orders list. */
export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderInput) => dataAdapter.createOrder(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.orders.all });
    },
  });
}

/**
 * Start paying for an order that already exists.
 *
 * Not a query — it has a side effect on Stripe's side (an intent is created),
 * so re-running it on a window focus or a cache miss would be wrong. The
 * server keys intent creation on the order id, so a retry resolves to the same
 * intent rather than a second one.
 */
export function useCreatePaymentIntent() {
  return useMutation({
    mutationFn: ({ reference, email }: { reference: string; email?: string }) =>
      dataAdapter.createPaymentIntent(reference, email),
  });
}

/** Look up an order by reference (confirmation / receipt). */
export function useOrder(reference: string) {
  return useQuery({
    queryKey: queryKeys.orders.detail(reference),
    queryFn: () => dataAdapter.getOrderByReference(reference),
    enabled: reference.length > 0,
  });
}

/** Round 3 #1.3: Returns' staff-authorized order lookup — no email needed. */
export function useOrderLookupAsStaff(reference: string) {
  return useQuery({
    queryKey: [...queryKeys.orders.detail(reference), 'staff-lookup'],
    queryFn: () => dataAdapter.lookupOrderAsStaff(reference),
    enabled: reference.length > 0,
  });
}

/** Admin: all orders. */
export function useOrders() {
  return useQuery({
    queryKey: queryKeys.orders.all,
    queryFn: () => dataAdapter.listOrders(),
  });
}

/**
 * Admin: move an online order along its fulfilment path. Optimistic — the
 * board should feel instant at the counter — with a rollback if the adapter
 * rejects the transition.
 */
export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      courier,
      trackingNumber,
    }: {
      id: string;
      status: OrderStatus;
      // Only meaningful — and only required by the API — for status: 'shipped'.
      courier?: string;
      trackingNumber?: string;
    }) => dataAdapter.updateOrderStatus(id, status, { courier, trackingNumber }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: queryKeys.orders.all });
      const previous = qc.getQueryData(queryKeys.orders.all);
      qc.setQueryData(queryKeys.orders.all, (current: unknown) =>
        Array.isArray(current) ? current.map((o) => (o.id === id ? { ...o, status } : o)) : current,
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData(queryKeys.orders.all, context.previous);
      }
      toast(error.message || 'Could not update that order — try again.');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.orders.all });
    },
  });
}

/**
 * Admin: the V5C/driving-licence documents on a plate order (bug fix, post-
 * "final pass" report #6). Only fetched once the details dialog opens for
 * an order that actually has a delivery address requiring verification —
 * the caller passes `enabled`, same convention as useCustomerAddress.
 */
export function useOrderDocuments(reference: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.orders.documents(reference),
    queryFn: () => dataAdapter.listOrderDocuments(reference),
    enabled: enabled && reference.length > 0,
  });
}

export function useApproveOrderDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reference, kind }: { reference: string; kind: 'v5c' | 'driving_licence' }) =>
      dataAdapter.approveOrderDocument(reference, kind),
    onSuccess: (_data, { reference }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.orders.documents(reference) });
    },
    onError: (error) => toast(error.message || 'Could not approve that document — try again.'),
  });
}

export function useRejectOrderDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reference,
      kind,
      reason,
    }: {
      reference: string;
      kind: 'v5c' | 'driving_licence';
      reason: string;
    }) => dataAdapter.rejectOrderDocument(reference, kind, reason),
    onSuccess: (_data, { reference }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.orders.documents(reference) });
    },
    onError: (error) => toast(error.message || 'Could not reject that document — try again.'),
  });
}

/** A fresh 60s signed download link, minted on click — never cached. */
export function useOrderDocumentDownloadUrl() {
  return useMutation({
    mutationFn: ({ reference, kind }: { reference: string; kind: 'v5c' | 'driving_licence' }) =>
      dataAdapter.getOrderDocumentDownloadUrl(reference, kind),
  });
}

/** Admin: all bookings. */
export function useBookings() {
  return useQuery({
    queryKey: queryKeys.bookings.all,
    queryFn: () => dataAdapter.listBookings(),
  });
}

/**
 * Round 5 Phase 3 #22 — the signed-in customer's own order history, for the
 * account dashboard. `enabled` defaults to true but the caller always
 * passes `session?.kind === 'customer'` explicitly, same convention as
 * `useCustomerAddress` — never fires for a guest or a staff session.
 */
export function useMyOrders(enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.myOrders,
    queryFn: () => dataAdapter.listMyOrders(),
    enabled,
  });
}

/** Round 5 Phase 3 #22 — the signed-in customer's own repair bookings. */
export function useMyBookings(enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.myBookings,
    queryFn: () => dataAdapter.listMyBookings(),
    enabled,
  });
}
