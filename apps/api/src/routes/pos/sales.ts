import { attempt, db, rpc } from '../../lib/db.js';
import { requireStaff, requireUnlocked, requirePermission } from '../../middleware/auth.js';
import { saleInputBodySchema, ticketCheckBodySchema } from '../../schemas.js';
import { toApiSale } from './helpers.js';
import { createRouter } from '../../lib/router.js';
import { tillShop } from '../../lib/shopScope.js';
import { priceTicket, TicketError, type PricedLine } from './pricing.js';

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

    let pLines: PricedLine[];
    try {
      ({ pLines } = await priceTicket(body.lines, tillShop(req)));
    } catch (err) {
      if (err instanceof TicketError) return res.status(err.status).json({ error: err.message });
      throw err;
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

/* ---------------------------------------------------------------------- */
/* "Is this ticket at or below cost?" — answered here, not in the browser   */
/* ---------------------------------------------------------------------- */

/**
 * The till warns (never blocks) when a ticket's total is at or below what the goods cost. That
 * needs cost prices, which a till operator without `costs.view` is not sent — so the question
 * goes to the server, priced exactly as the sale will be, and only a yes/no comes back.
 *
 * Same definition as complete_sale(): (subtotal - discount) <= cost.
 */
router.post(
  '/sales/below-cost',
  requireStaff,
  requireUnlocked,
  requirePermission('pos.operate'),
  async (req, res) => {
    const parsed = ticketCheckBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    try {
      const { subtotal, cost } = await priceTicket(parsed.data.lines, tillShop(req));
      return res.json({ belowCost: subtotal - parsed.data.discount <= cost });
    } catch (err) {
      if (err instanceof TicketError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  },
);
