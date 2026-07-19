'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DeliveryMethod } from '@/lib/data/types';
import type { PaymentMethodId } from '@/lib/payments/provider';

/**
 * Checkout form state (6.3) — persisted so progress survives a refresh /
 * back-button. Guest checkout by default (no account needed). Cleared after a
 * successful order. Contains contact details for convenience prefill only.
 */
interface CheckoutState {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  postcode: string;
  delivery: DeliveryMethod;
  paymentMethod: PaymentMethodId;
  promoCode: string;
  set: <K extends keyof CheckoutFields>(key: K, value: CheckoutFields[K]) => void;
  reset: () => void;
}

type CheckoutFields = Omit<CheckoutState, 'set' | 'reset'>;

const initial: CheckoutFields = {
  email: '',
  firstName: '',
  lastName: '',
  phone: '',
  address: '',
  postcode: '',
  delivery: 'collect',
  paymentMethod: 'stripe',
  promoCode: '',
};

export const useCheckoutStore = create<CheckoutState>()(
  persist(
    (set) => ({
      ...initial,
      set: (key, value) => set({ [key]: value } as Partial<CheckoutState>),
      reset: () => set({ ...initial }),
    }),
    { name: 'fonology-checkout' },
  ),
);
