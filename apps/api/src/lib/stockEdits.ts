/**
 * A stock count typed on an edit form (the product form, a variation's row or pop-up).
 *
 * Those forms show the count as it was when they opened and send the whole form back on Save. The
 * server used to work out "the box minus the count now" and move stock by the difference, so a sale or
 * a delivery that happened while the form was open was quietly undone: opened at 25, the till sold one
 * (24), someone fixed a typo in the name and saved, and stock went back to 25. A delivery booked in
 * meanwhile was taken off again the same way. Found by the deep audit of 9 Nov 2026.
 *
 * So a form now also sends the count it opened with (`was`):
 *   - box untouched           -> stock is left alone, whatever happened meanwhile
 *   - box changed, no movement -> the box is the new count, as before
 *   - box changed AND stock moved while the form was open -> refused: the typed figure was counted
 *     against a number that is no longer true, and guessing which one wins is how stock drifts
 * Without `was` (an older page still open in a browser) the box is the count, as it always was.
 */
export type StockEditPlan =
  | { kind: 'none' }
  | { kind: 'move'; delta: number }
  | { kind: 'conflict'; was: number; now: number; typed: number };

export function planStockEdit(typed: number, was: number | undefined, now: number): StockEditPlan {
  if (was !== undefined) {
    if (typed === was || typed === now) return { kind: 'none' };
    if (now !== was) return { kind: 'conflict', was, now, typed };
  }
  const delta = typed - now;
  return delta === 0 ? { kind: 'none' } : { kind: 'move', delta };
}

/** What the person at the form reads. Nothing was saved, and saving again uses their figure. */
export function stockConflictMessage(
  plan: { was: number; now: number; typed: number },
  what?: string,
): string {
  return (
    `The stock${what ? ` of ${what}` : ''} changed from ${plan.was} to ${plan.now} while you had this open ` +
    `(a sale or a delivery), so nothing was saved. Check the count — saving again will set it to ${plan.typed}.`
  );
}

/** Same idea for the cost: an untouched cost box must not overwrite the average Goods in just worked out. */
export function costWasTyped(typed: number, was: number | undefined): boolean {
  return was === undefined || typed !== was;
}

/** Thrown inside the save's transaction so nothing lands; the route answers 409 with the count now. */
export class StockChangedError extends Error {
  constructor(
    readonly plan: { was: number; now: number; typed: number },
    what?: string,
  ) {
    super(stockConflictMessage(plan, what));
    this.name = 'StockChangedError';
  }
}
