import type { Money } from '@/lib/data/types';

/**
 * Card machine abstraction (item 8). Hardware is TBC — likely Stripe
 * Terminal. The POS only ever talks to `paymentTerminal`, so a real SDK
 * drops in behind this exact interface with zero POS changes.
 *
 * MOCK BEHAVIOUR: `charge()` immediately enters "waiting for card…"; the UI
 * shows manual Confirm / Cancel buttons that settle the promise. A real
 * implementation resolves `result` from the hardware and makes `confirm()`
 * a no-op (`cancel()` maps to the SDK's cancel).
 */

export type TerminalOutcome = 'approved' | 'cancelled';

export interface TerminalCharge {
  /** Settles when the card machine approves or the charge is cancelled. */
  result: Promise<TerminalOutcome>;
  /** Mock-only manual approval (real hardware resolves `result` itself). */
  confirm: () => void;
  cancel: () => void;
}

export interface PaymentTerminalService {
  charge(amount: Money, terminal: 'pos1' | 'pos2'): TerminalCharge;
}

const mockTerminal: PaymentTerminalService = {
  charge() {
    let settle: (outcome: TerminalOutcome) => void;
    const result = new Promise<TerminalOutcome>((resolve) => {
      settle = resolve;
    });
    return {
      result,
      confirm: () => settle('approved'),
      cancel: () => settle('cancelled'),
    };
  },
};

/** The live terminal service — swap for the Stripe Terminal adapter here. */
export const paymentTerminal: PaymentTerminalService = mockTerminal;
