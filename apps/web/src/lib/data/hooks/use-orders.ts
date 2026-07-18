'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataAdapter } from '../adapters';
import type { OrderInput } from '../types';
import { queryKeys } from './query-keys';

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

/** Look up an order by reference (confirmation / receipt). */
export function useOrder(reference: string) {
  return useQuery({
    queryKey: queryKeys.orders.detail(reference),
    queryFn: () => dataAdapter.getOrderByReference(reference),
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

/** Admin: all bookings. */
export function useBookings() {
  return useQuery({
    queryKey: queryKeys.bookings.all,
    queryFn: () => dataAdapter.listBookings(),
  });
}
