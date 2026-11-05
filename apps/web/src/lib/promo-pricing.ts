/**
 * Till promotion pricing: pure, so the till screen can show the same total the server charges.
 * KEEP IN STEP with apps/api/src/lib/promoPricing.ts. A difference between the two makes the
 * payments not add up and the sale is refused.
 *
 * A tier's per-item rate is its total ÷ its quantity, and applies from that quantity up until a
 * bigger tier takes over: with 2 for £10 and 4 for £16, 3 cost £15 and 5 cost £20.
 *
 * Which offer prices an item: one naming the product beats one on a category, a nearer category
 * beats a further one, and at the same level the newest wins. Offers never stack.
 *
 * Mix & Match on: everything the offer covers on the ticket counts towards the quantity together.
 * Off: each line counts on its own.
 *
 * An item whose own price is already lower than the deal keeps its own price.
 */

export interface PromoTierRule {
  minQty: number;
  totalPrice: number;
}

export interface PromoRule {
  groupId: string;
  mixMatch: boolean;
  /** The product this rule names, or null for a category rule. */
  productId: string | null;
  /** For a category rule: every category it reaches, with how far below the named one (0 = itself). */
  categories: { id: string; depth: number }[];
  /** ISO timestamp; later wins a tie. */
  createdAt: string;
  tiers: PromoTierRule[];
}

export interface BasketLine {
  productId: string;
  categoryId: string | null;
  quantity: number;
  listPrice: number;
}

export interface PricedBasketLine {
  /** The line's total in pence. */
  total: number;
  /** Whole-pence unit prices that add up to `total` exactly (two when it does not divide evenly). */
  units: { unitPrice: number; quantity: number }[];
  tierApplied: boolean;
}

export function findRule(line: BasketLine, rules: PromoRule[]): PromoRule | null {
  let best: PromoRule | null = null;
  let bestRank = Infinity;
  for (const rule of rules) {
    let rank: number;
    if (rule.productId !== null) {
      if (rule.productId !== line.productId) continue;
      rank = 0;
    } else {
      const hit = rule.categories.find((c) => c.id === line.categoryId);
      if (!hit) continue;
      rank = 1 + hit.depth;
    }
    if (rank < bestRank || (rank === bestRank && best && rule.createdAt > best.createdAt)) {
      best = rule;
      bestRank = rank;
    }
  }
  return best;
}

function bestTier(tiers: PromoTierRule[], quantity: number): PromoTierRule | null {
  let best: PromoTierRule | null = null;
  for (const tier of tiers) {
    if (tier.minQty <= quantity && (!best || tier.minQty > best.minQty)) best = tier;
  }
  return best;
}

function splitUnits(total: number, quantity: number): PricedBasketLine['units'] {
  const base = Math.floor(total / quantity);
  const extra = total - base * quantity;
  const units: PricedBasketLine['units'] = [];
  if (quantity - extra > 0) units.push({ unitPrice: base, quantity: quantity - extra });
  if (extra > 0) units.push({ unitPrice: base + 1, quantity: extra });
  return units;
}

/** Prices a ticket's catalogue lines. The result is in the same order as `lines`. */
export function priceBasket(lines: BasketLine[], rules: PromoRule[]): PricedBasketLine[] {
  const ruleFor = lines.map((line) => findRule(line, rules));

  const poolQty = new Map<string, number>();
  const poolOf = lines.map((_, i) => {
    const rule = ruleFor[i];
    return rule?.mixMatch ? `group:${rule.groupId}` : `line:${i}`;
  });
  lines.forEach((line, i) => {
    const key = poolOf[i]!;
    poolQty.set(key, (poolQty.get(key) ?? 0) + line.quantity);
  });

  // Rounded on the running total, so a pool's lines always add up to its exact price.
  const poolSoFar = new Map<string, number>();
  return lines.map((line, i) => {
    const rule = ruleFor[i];
    const key = poolOf[i]!;
    const tier = rule ? bestTier(rule.tiers, poolQty.get(key)!) : null;
    const listTotal = line.listPrice * line.quantity;
    if (!tier)
      return { total: listTotal, units: splitUnits(listTotal, line.quantity), tierApplied: false };

    const before = poolSoFar.get(key) ?? 0;
    const after = before + line.quantity;
    poolSoFar.set(key, after);
    const dealTotal =
      Math.round((tier.totalPrice * after) / tier.minQty) -
      Math.round((tier.totalPrice * before) / tier.minQty);

    if (dealTotal >= listTotal) {
      return { total: listTotal, units: splitUnits(listTotal, line.quantity), tierApplied: false };
    }
    return { total: dealTotal, units: splitUnits(dealTotal, line.quantity), tierApplied: true };
  });
}
