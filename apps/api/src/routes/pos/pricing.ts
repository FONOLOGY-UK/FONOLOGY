import { attempt, db, rpc } from '../../lib/db.js';

/**
 * Pricing a till ticket on the server — the ONE definition, used by completing a sale and by the
 * below-cost check that runs while the ticket is being built.
 *
 * The client never supplies a catalogue price: every catalogue line is priced here from the
 * database (shelf price, a variation's own price, bulk-tier promotions). A misc line (item 10) has
 * nothing to price against, so its typed price is taken as given — the narrowest exception.
 *
 * It also totals the COST of the ticket, which is why this lives on the server: cost prices are
 * not sent to a till operator who lacks `costs.view`, yet the below-cost warning still has to be
 * right. The browser asks "is this ticket at or below cost?" and gets a yes/no, never a figure.
 */

export class TicketError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface TicketLineInput {
  productId?: string | null;
  variantId?: string | null;
  name?: string;
  quantity: number;
  unitPrice?: number;
  costPrice?: number;
}

export interface PricedLine {
  product_id?: string;
  variant_id?: string | null;
  name?: string;
  quantity: number;
  unit_price: number;
  list_price?: number;
  cost_price?: number;
  tier_applied?: boolean;
}

export interface PricedTicket {
  pLines: PricedLine[];
  /** Sum of unit price x quantity, before any discount. */
  subtotal: number;
  /** Sum of cost x quantity. A misc line with no cost counts as 0, exactly as complete_sale() does. */
  cost: number;
}

/** Prices every line of a ticket for the given shop. Throws TicketError for a line that can't be sold. */
export async function priceTicket(
  lines: TicketLineInput[],
  shopId: string | null,
): Promise<PricedTicket> {
  // A line with no productId is a "Misc" line — a non-catalogue item sold once. Not looked up,
  // not consumed from stock.
  const catalogueLines = lines.filter((l) => l.productId);
  const miscLines = lines.filter((l) => !l.productId);

  const productIds = [...new Set(catalogueLines.map((l) => l.productId as string))];
  const variantIds = [
    ...new Set(catalogueLines.map((l) => l.variantId).filter(Boolean)),
  ] as string[];
  const { data: basket, error: basketErr } = await attempt(() =>
    Promise.all([
      productIds.length
        ? db
            .selectFrom('products')
            .select(['id', 'price', 'cost_price', 'is_active', 'kind', 'shop_id', 'has_variants'])
            .where('id', 'in', productIds)
            .execute()
        : Promise.resolve([]),
      variantIds.length
        ? db
            .selectFrom('product_variants')
            .select(['id', 'product_id', 'price', 'cost_price', 'is_active'])
            .where('id', 'in', variantIds)
            .execute()
        : Promise.resolve([]),
    ]),
  );
  if (basketErr) throw new TicketError(500, 'Could not validate the basket.');
  const [products, variants] = basket;
  const byId = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const pLines: PricedLine[] = [];
  let subtotal = 0;
  let cost = 0;
  const unavailable = 'One of the items on this ticket is no longer available.';

  // One pricing call per line, issued together instead of one after another (a ticket of ten lines used to
  // cost ten sequential round trips). A line whose product is unknown is skipped here and rejected below
  // with its own 400, exactly as before.
  const resolvedPrices = await Promise.all(
    catalogueLines.map((line) =>
      byId.has(line.productId as string)
        ? attempt(() =>
            rpc<number>('resolve_sale_unit_price', {
              p_product_id: line.productId as string,
              p_quantity: line.quantity,
            }),
          )
        : Promise.resolve(null),
    ),
  );

  for (const [index, line] of catalogueLines.entries()) {
    const product = byId.get(line.productId as string);
    // A till only sells its own shop's stock (complete_sale() enforces it too).
    if (!product || !product.is_active || product.shop_id !== shopId) {
      throw new TicketError(400, unavailable);
    }
    // Vapes ARE sellable at the till (unlike online) — no kind check, deliberately.

    let variant: (typeof variants)[number] | null = null;
    if (line.variantId) {
      const v = variantById.get(line.variantId);
      if (!v || !v.is_active || v.product_id !== line.productId) {
        throw new TicketError(400, unavailable);
      }
      variant = v;
    } else if (product.has_variants) {
      // The parent of a variation product is a placeholder (0107) — only a variation is sold.
      throw new TicketError(400, 'Pick which option of this product is being sold.');
    }

    // The real per-unit price, resolved server-side. A variation sells at its own price unless a
    // bulk tier (product-level) fires and comes in lower — a tier, when it does, is the price.
    const priced = resolvedPrices[index];
    if (!priced || priced.error) throw new TicketError(500, 'Could not price one of the items.');
    const resolvedPrice = priced.data;

    const listPrice = variant ? variant.price : product.price;
    const tierFired = resolvedPrice < product.price;
    const realUnitPrice = tierFired ? Math.min(resolvedPrice, listPrice) : listPrice;
    const tierApplied = realUnitPrice < listPrice;

    pLines.push({
      product_id: line.productId as string,
      variant_id: variant?.id ?? null,
      quantity: line.quantity,
      unit_price: realUnitPrice,
      list_price: listPrice,
      tier_applied: tierApplied,
    });
    subtotal += realUnitPrice * line.quantity;
    cost += (variant ? variant.cost_price : product.cost_price) * line.quantity;
  }

  // Misc lines: costPrice absent means "not known yet" — the sale completes, the line is flagged
  // for a cost to be filled in later. A cost of 0 sent on purpose is a real zero.
  for (const line of miscLines) {
    pLines.push({
      name: (line.name ?? '').trim(),
      quantity: line.quantity,
      unit_price: line.unitPrice as number,
      ...(line.costPrice !== undefined ? { cost_price: line.costPrice } : {}),
    });
    subtotal += (line.unitPrice as number) * line.quantity;
    cost += (line.costPrice ?? 0) * line.quantity;
  }

  return { pLines, subtotal, cost };
}
