import type { Money } from '@/lib/data/types';

/**
 * PAYMENT ABSTRACTION (6.3) — UI ONLY.
 * ====================================
 * The checkout selects a provider and calls `pay()`. Today these are mocks that
 * just resolve after a short delay so the UI flow is exercised — NO real payment
 * is taken. Raja swaps the mock bodies for the real Stripe / Clearpay SDKs
 * without the checkout UI changing: same interface, same call site.
 */
export type PaymentMethodId = 'stripe' | 'clearpay';

export interface PaymentResult {
  ok: boolean;
  /** Provider-side reference (mock today, real intent/charge id later). */
  providerRef: string;
}

export interface PaymentProvider {
  id: PaymentMethodId;
  label: string;
  blurb: string;
  /** Charge `amount` (pence). MOCK — resolves ok after a short delay. */
  pay(amount: Money): Promise<PaymentResult>;
}

function mockPay(prefix: string): Promise<PaymentResult> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({ ok: true, providerRef: `${prefix}_${Math.random().toString(36).slice(2, 10)}` }),
      1400,
    ),
  );
}

export const PAYMENT_PROVIDERS: Record<PaymentMethodId, PaymentProvider> = {
  stripe: {
    id: 'stripe',
    label: 'Card',
    blurb: 'Visa, Mastercard, Amex — secured by Stripe.',
    pay: () => mockPay('pi'),
  },
  clearpay: {
    id: 'clearpay',
    label: 'Clearpay',
    blurb: '4 interest-free payments, every 2 weeks.',
    pay: () => mockPay('cp'),
  },
};

export function getPaymentProvider(id: PaymentMethodId): PaymentProvider {
  return PAYMENT_PROVIDERS[id];
}
