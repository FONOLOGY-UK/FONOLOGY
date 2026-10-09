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

    // Idempotency (0110): the till sends one key per attempt. Reserve it first - the primary key makes that
    // atomic - so a retry whose first attempt DID land returns that sale instead of making a second one.
    const shopId = tillShop(req);
    const key = body.idempotencyKey;
    if (key && shopId) {
      const reserved = await db
        .insertInto('sale_idempotency_keys')
        .values({ shop_id: shopId, key })
        .onConflict((oc) => oc.columns(['shop_id', 'key']).doNothing())
        .returning('key')
        .executeTakeFirst();
      if (!reserved) {
        const earlier = await db
          .selectFrom('sale_idempotency_keys')
          .select('sale_id')
          .where('shop_id', '=', shopId)
          .where('key', '=', key)
          .executeTakeFirst();
        if (earlier?.sale_id) {
          const existing = await db
            .selectFrom('sales')
            .selectAll()
            .where('id', '=', earlier.sale_id)
            .executeTakeFirstOrThrow();
          return res.status(200).json(await toApiSale(existing));
        }
        // A reservation with no sale that is more than two minutes old was left behind by a crash; free it so
        // this attempt can go ahead. A younger one is a sale still being made: do not make a second.
        const stale = await db
          .deleteFrom('sale_idempotency_keys')
          .where('shop_id', '=', shopId)
          .where('key', '=', key)
          .where('sale_id', 'is', null)
          .where('created_at', '<', new Date(Date.now() - 2 * 60_000).toISOString())
          .returning('key')
          .executeTakeFirst();
        if (!stale) {
          return res.status(409).json({
            error: 'This sale is already being processed. Check today’s sales before trying again.',
          });
        }
        await db
          .insertInto('sale_idempotency_keys')
          .values({ shop_id: shopId, key })
          .onConflict((oc) => oc.columns(['shop_id', 'key']).doNothing())
          .execute();
      }
    }
    const releaseKey = () =>
      key && shopId
        ? db
            .deleteFrom('sale_idempotency_keys')
            .where('shop_id', '=', shopId)
            .where('key', '=', key)
            .execute()
            .catch(() => undefined)
        : Promise.resolve(undefined);

    const { data: saleId, error: saleErr } = await attempt(() =>
      rpc<string>('complete_sale', {
        p_staff_id: req.user!.id,
        p_lines: pLines,
        p_payments: pPayments,
        p_discount: body.discount,
        p_below_cost_reason: body.belowCostReason ?? null,
      }),
    ).catch(async (err: unknown) => {
      await releaseKey();
      throw err;
    });

    if (saleErr) {
      await releaseKey();
      console.error('[till] complete_sale rejected', {
        staffId: req.user!.id,
        payments: pPayments,
        discount: body.discount,
        lineCount: pLines.length,
        error: saleErr.message,
      });
      // A rule the sale broke (our own RAISE, a constraint, a bad value) is a 409 the cashier can act on.
      // Anything else - a deadlock, a timeout, a database that is struggling - is a fault, not a ticket
      // problem, and must not be dressed up as one.
      const ticketProblem = /^(P0001|22|23)/.test(saleErr.code);
      if (!ticketProblem) {
        return res.status(503).json({
          error:
            'The till could not reach the database just now - nothing was charged. Please try again.',
        });
      }
      return res.status(409).json({
        error:
          "Something didn't add up completing this sale — nothing was charged. Try again, or call a manager if it keeps happening.",
      });
    }

    if (key && shopId) {
      await db
        .updateTable('sale_idempotency_keys')
        .set({ sale_id: saleId })
        .where('shop_id', '=', shopId)
        .where('key', '=', key)
        .execute()
        .catch((err) => {
          // The sale exists; only the retry-protection is missing. Never fail a completed sale for it.
          console.error('[till] could not record the idempotency key for sale', saleId, err);
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
