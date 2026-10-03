import { attempt, db, rpc } from '../../lib/db.js';
import { requireStaff, requireUnlocked, requirePermission } from '../../middleware/auth.js';
import { saleInputBodySchema } from '../../schemas.js';
import { toApiSale } from './helpers.js';
import { createRouter } from '../../lib/router.js';

export const posSalesRouter = createRouter();
const router = posSalesRouter;

/* ---------------------------------------------------------------------- */
/* Complete a sale                                                          */
/* ---------------------------------------------------------------------- */

router.post(
  '/sales',
  requireStaff,
  requireUnlocked,
  requirePermission('pos.operate'),
  async (req, res) => {
    const parsed = saleInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    // Change request item 10: a line with no productId is a "Misc" line — a
    // non-catalogue item the till is selling once. It is not looked up, not
    // priced from the database (there is nothing to price it from) and not
    // consumed from stock. Split them out here so the existing catalogue path
    // below is untouched and cannot accidentally receive one.
    const catalogueLines = body.lines.filter((l) => l.productId);
    const miscLines = body.lines.filter((l) => !l.productId);

    const productIds = [...new Set(catalogueLines.map((l) => l.productId as string))];
    const variantIds = [
      ...new Set(catalogueLines.map((l) => l.variantId).filter(Boolean)),
    ] as string[];
    const { data: basket, error: basketErr } = await attempt(() =>
      Promise.all([
        productIds.length
          ? db
              .selectFrom('products')
              .select(['id', 'price', 'is_active', 'kind'])
              .where('id', 'in', productIds)
              .execute()
          : Promise.resolve([]),
        variantIds.length
          ? db
              .selectFrom('product_variants')
              .select(['id', 'product_id', 'price_adjustment', 'is_active'])
              .where('id', 'in', variantIds)
              .execute()
          : Promise.resolve([]),
      ]),
    );
    if (basketErr) return res.status(500).json({ error: 'Could not validate the basket.' });
    const [products, variants] = basket;
    const byId = new Map(products.map((p) => [p.id, p]));
    const variantById = new Map(variants.map((v) => [v.id, v]));

    const pLines: Array<{
      product_id?: string;
      variant_id?: string | null;
      name?: string;
      quantity: number;
      unit_price: number;
      list_price?: number;
      cost_price?: number;
      tier_applied?: boolean;
    }> = [];

    for (const line of catalogueLines) {
      const product = byId.get(line.productId as string);
      if (!product || !product.is_active) {
        return res
          .status(400)
          .json({ error: 'One of the items on this ticket is no longer available.' });
      }
      // Vapes ARE sellable at the till (unlike online) — no kind check here at
      // all, deliberately, unlike orders.routes.ts's vape rejection.

      let variant: { id: string; product_id: string; price_adjustment: number } | null = null;
      if (line.variantId) {
        const v = variantById.get(line.variantId);
        if (!v || !v.is_active || v.product_id !== line.productId) {
          return res
            .status(400)
            .json({ error: 'One of the items on this ticket is no longer available.' });
        }
        variant = v;
      }

      // The real per-unit price, resolved server-side — the schema's own bulk-
      // tier logic, never the client's claimed unitPrice/tierApplied.
      // resolve_sale_unit_price() (0013) is untouched by variants: promotions
      // stay product-level (trimmed v1). It returns either the best
      // qualifying tier's price (an absolute override) or the plain shelf
      // price when no tier applies. A variant's price_adjustment only ever
      // applies in that second case — a tier, when it fires, is the price,
      // full stop, same behaviour as a non-variant product today.
      const { data: resolvedPrice, error: priceErr } = await attempt(() =>
        rpc<number>('resolve_sale_unit_price', {
          p_product_id: line.productId as string,
          p_quantity: line.quantity,
        }),
      );
      if (priceErr) return res.status(500).json({ error: 'Could not price one of the items.' });

      const shelfPrice = product.price;
      const tierApplied = resolvedPrice < shelfPrice;
      const realUnitPrice =
        tierApplied || !variant ? resolvedPrice : shelfPrice + variant.price_adjustment;
      const listPrice = variant ? shelfPrice + variant.price_adjustment : shelfPrice;

      pLines.push({
        product_id: line.productId,
        variant_id: variant?.id ?? null,
        quantity: line.quantity,
        unit_price: realUnitPrice,
        list_price: listPrice,
        tier_applied: tierApplied,
      });
    }

    /*
     * Item 10 — the misc lines.
     *
     * This is the one place in the till where a price comes from the person
     * at the counter rather than from the database, and it is unavoidable:
     * the item does not exist, so there is nothing to price it against. The
     * exception is kept as narrow as it can be — only a line with NO
     * productId can take this path, every catalogue line above is still
     * priced by resolve_sale_unit_price(), and complete_sale() stores these
     * with product_id null so "show me every price a staff member typed by
     * hand" stays one query forever.
     *
     * costPrice absent is the point of the feature: the sale completes now,
     * the line is stored with a 0 placeholder and cost_price_pending = true,
     * and it appears on the "needs a cost price" list until someone fills it
     * in. A costPrice of 0 sent deliberately is a real zero and is not
     * flagged — the two are different answers and the till can say either.
     */
    for (const line of miscLines) {
      pLines.push({
        name: (line.name ?? '').trim(),
        quantity: line.quantity,
        unit_price: line.unitPrice as number,
        ...(line.costPrice !== undefined ? { cost_price: line.costPrice } : {}),
      });
    }

    if (pLines.length === 0) {
      return res.status(400).json({ error: 'A sale needs at least one line.' });
    }

    // `reference` is the card machine's slip reference, passed straight
    // through to complete_sale (0030), which records it alongside who
    // confirmed the leg. Optional at every layer; undefined simply means the
    // operator didn't type one. confirmed_by is NOT sent from here — the
    // function takes it from p_staff_id, i.e. the session.
    const pPayments = body.payments.map((p) => ({
      tender: p.tender,
      amount: p.amount,
      reference: p.reference ?? null,
    }));

    const { data: saleId, error: saleErr } = await attempt(() =>
      rpc<string>('complete_sale', {
        p_staff_id: req.user!.id,
        p_lines: pLines,
        p_payments: pPayments,
        p_discount: body.discount,
        p_below_cost_reason: body.belowCostReason ?? null,
      }),
    );

    if (saleErr) {
      // Below is the one case that used to hand a customer-facing screen a
      // sentence built from raw pence with no currency symbol ("Sale <uuid>
      // payments (5250) do not equal the total (5500)") — batch 2 item C.
      //
      // No logging existed on this path before this change — checked first,
      // as asked. There was nothing here to lose by adding it.
      //
      // Deliberately not reworded into the same "here are the two numbers"
      // shape the other three sites get. The split-payment screen already
      // sums client-side before Record is ever pressable, so in practice
      // this can only fire from a genuine bug or a race — not something a
      // till operator can act on by being told the arithmetic. What they
      // can act on is retrying, or calling someone if it keeps happening;
      // the actual figures go to the server log instead, where whoever
      // investigates can find them attached to this exact attempt.
      // eslint-disable-next-line no-console
      // The heading used to assert "payments do not match the total", which
      // is only ONE of the things complete_sale() raises — it also refuses an
      // unknown product, an unknown variant, an empty line list and, since
      // 0085, a misc line with no name or price. Tripped over while verifying
      // item 10 against a database that did not yet have 0085: the real error
      // was "Product <NULL> not found" and the log confidently said the
      // payments were wrong, which is the worst possible thing for a log line
      // to do to whoever is reading it at 5pm on a Saturday. The message the
      // OPERATOR sees is unchanged and deliberately vague — they can only
      // retry either way — but the log now says what actually happened.
      console.error('[till] complete_sale rejected', {
        staffId: req.user!.id,
        payments: pPayments,
        discount: body.discount,
        lineCount: pLines.length,
        error: saleErr.message,
      });
      return res.status(409).json({
        error:
          "Something didn't add up completing this sale — nothing was charged. Try again, or call a manager if it keeps happening.",
      });
    }

    const saleRow = await db
      .selectFrom('sales')
      .selectAll()
      .where('id', '=', saleId)
      .executeTakeFirstOrThrow();
    return res.status(201).json(await toApiSale(saleRow));
  },
);
