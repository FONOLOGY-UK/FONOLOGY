'use client';

import type { Money } from '@/lib/data/types';

/**
 * The card machines, as they actually work in this shop.
 *
 * BOTH machines are manual entry, and the client has signed this off as the
 * real process, not a stopgap:
 *
 *   1. Staff key the amount into the machine.
 *   2. The customer pays on the machine.
 *   3. Staff read the machine's own result.
 *   4. Staff confirm that result here.
 *
 * POS 1 is Shift4, POS 2 is a Dojo PAX A920 — but that mapping is a settings
 * value (`shop_settings.card_machine_labels`, migration 0030), not a fact this
 * module knows, because the shop has already changed card provider once.
 *
 * There is NO SDK and no reader integration. The Stripe Terminal / WisePOS E
 * plan was cancelled and no reader is being bought, so nothing here is a
 * placeholder waiting to be swapped out. `confirm()` and `cancel()` are the
 * product, not a stand-in for hardware callbacks.
 *
 * Online Stripe checkout (where a customer pays unattended on the website) is
 * a separate, unbuilt thing, blocked on the client's account. It does not come
 * through here.
 */

/** What the staff member read off the machine. */
export type CardOutcome = 'approved' | 'cancelled';

export interface CardPaymentAttempt {
  /** Settles when a human confirms or cancels what the machine showed. */
  result: Promise<CardOutcome>;
  /** The machine approved it. */
  confirm: () => void;
  /** Declined, cancelled, or the customer changed their mind. */
  cancel: () => void;
}

export interface CardMachineService {
  /**
   * Begin a payment attempt on one of the two counter machines.
   *
   * The amount is passed in only so the UI can show what staff should key in;
   * this call charges nothing and cannot. The figure that ends up recorded is
   * the server-computed sale total split across the legs the operator set up —
   * confirming a payment records that money arrived, it never decides how much.
   */
  begin(amount: Money, machine: 'pos1' | 'pos2'): CardPaymentAttempt;
}

export const cardMachine: CardMachineService = {
  begin() {
    let settle: (outcome: CardOutcome) => void;
    const result = new Promise<CardOutcome>((resolve) => {
      settle = resolve;
    });
    return {
      result,
      confirm: () => settle('approved'),
      cancel: () => settle('cancelled'),
    };
  },
};
