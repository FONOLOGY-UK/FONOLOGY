import type { StorefrontVariant } from '@/lib/data/types';

/**
 * Choosing a variation on the product page (0107, spec §7.1). Pure, so it is unit-tested
 * (variation-select.test.ts) rather than only clicked.
 *
 * The page holds the variation the customer is on. Clicking an option value asks for the
 * variation with that value and every other choice unchanged; when that combination isn't
 * made (it was disabled, or never existed), the customer is moved to the closest one that does
 * include the value they clicked — never to a dead end.
 */

type Options = Record<string, string>;

/** The variation with exactly these choices, if there is one. */
export function findVariant(variants: StorefrontVariant[], selected: Options) {
  const keys = Object.keys(selected);
  return variants.find(
    (v) =>
      keys.every((k) => v.options[k] === selected[k]) &&
      Object.keys(v.options).length === keys.length,
  );
}

/**
 * The variation to show after clicking `value` of option `type`: the exact combination if it
 * exists, otherwise — among the variations that have that value — the one keeping the most of
 * the other choices, preferring one in stock, then the admin's order.
 */
export function chooseOption(
  variants: StorefrontVariant[],
  selected: Options,
  type: string,
  value: string,
): StorefrontVariant | undefined {
  const wanted = { ...selected, [type]: value };
  const exact = findVariant(variants, wanted);
  if (exact) return exact;
  let best: StorefrontVariant | undefined;
  let bestScore = -1;
  for (const v of variants) {
    if (v.options[type] !== value) continue;
    const kept = Object.keys(selected).filter((k) => k !== type && v.options[k] === selected[k]);
    const score = kept.length * 2 + (v.stockStatus === 'in-stock' ? 1 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

/**
 * How an option value's button reads, given the current choices:
 *   on        — it is part of the current variation
 *   available — the combination exists and is in stock
 *   out       — the combination exists but is out of stock (selectable, shown unavailable)
 *   elsewhere — not made with the other current choices; clicking moves to the closest one
 */
export function optionState(
  variants: StorefrontVariant[],
  selected: Options,
  type: string,
  value: string,
): 'on' | 'available' | 'out' | 'elsewhere' {
  if (selected[type] === value) {
    const current = findVariant(variants, selected);
    return current && current.stockStatus !== 'in-stock' ? 'out' : 'on';
  }
  const exact = findVariant(variants, { ...selected, [type]: value });
  if (!exact) return 'elsewhere';
  return exact.stockStatus === 'in-stock' ? 'available' : 'out';
}
