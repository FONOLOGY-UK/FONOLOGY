import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import type { Expression, ExpressionBuilder, SelectQueryBuilder, SqlBool } from 'kysely';
import { attempt, db, rpc, withActor } from '../lib/db.js';
import { formatPence } from '../lib/money.js';
import type { DB, SellRequestStatus } from '../db/types.js';
import { isUuid } from '../lib/uuid.js';
import { staffNamesFor } from '../lib/staffNames.js';
import { requireStaff, requirePermission, blockStaffCheckout } from '../middleware/auth.js';
import {
  sellRequestBodySchema,
  sellQuoteBodySchema,
  sellStatusBodySchema,
  sellPayoutBodySchema,
  restockBodySchema,
  sellRequestListQuerySchema,
  payoutListQuerySchema,
} from '../schemas.js';
import { page } from '../lib/pagination.js';
import { limitByIp } from '../lib/rateLimit.js';
import { sendTransactionalEmail } from '../lib/email.js';
import { escapeHtml } from '../lib/html.js';
import { config } from '../config.js';

import { createRouter } from '../lib/router.js';
import { canRead, canWrite, hubShopId, readShop, writeShop } from '../lib/shopScope.js';
import { isUuid as isUuidValue } from '../lib/uuid.js';

export const sellRouter = createRouter();

/**
 * The frontend's old SellStatus enum (received|quoted|accepted|paid|declined)
 * reused 'received' for the INITIAL submission; the schema's sell_request_status uses 'received' for
 * a LATER state (the device has physically arrived at the shop, after
 * acceptance) and has a distinct 'submitted' for the initial state, plus
 * 'rejected' (device inspected and found unfit) which that enum has no value
 * for at all. The same word means two different points in the flow on each
 * side — not a naming gap a hyphen/underscore swap can fix. Built here to
 * match the schema exactly.
 */

/**
 * A sell request with its device's name joined on — null for "something
 * else" requests. Every read below goes through this or `sellQueue()`, so the
 * name is never missing (never falling back to the raw id — see the fix
 * history for why that matters).
 */
function sellRequestWithDevice() {
  return db
    .selectFrom('sell_requests')
    .leftJoin('devices', 'devices.id', 'sell_requests.device_id')
    .selectAll('sell_requests')
    .select('devices.name as device_name');
}

async function loadSellRequest(id: string) {
  return sellRequestWithDevice().where('sell_requests.id', '=', id).executeTakeFirst();
}

function toApiSellRequest(row: Record<string, unknown>) {
  return {
    id: row.id,
    reference: row.reference,
    customerId: row.customer_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    preferredContact: row.preferred_contact,
    deviceId: row.device_id,
    deviceName: (row.device_name as string | null | undefined) ?? null,
    deviceOther: row.device_other,
    condition: row.condition,
    status: row.status,
    quotedAmount: row.quoted_amount,
    quotedBy: row.quoted_by,
    quotedAt: row.quoted_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

sellRouter.post(
  '/requests',
  limitByIp('sell-request-create', { max: 20, windowMs: 10 * 60_000 }),
  blockStaffCheckout('submit a sell-in request'),
  async (req, res) => {
    const parsed = sellRequestBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    if (!body.deviceId && !body.deviceOther) {
      return res
        .status(400)
        .json({ error: 'Pick a device, or describe it under "something else".' });
    }

    const requestShop = await hubShopId(); // online trade-ins are all handled by the hub shop
    const { data: row, error } = await attempt(async () => {
      const { id } = await db
        .insertInto('sell_requests')
        .values({
          shop_id: requestShop,
          device_id: body.deviceId ?? null,
          device_other: body.deviceOther ?? null,
          condition: JSON.stringify(body.condition),
          name: body.name,
          phone: body.phone,
          email: body.email,
          preferred_contact: body.preferredContact,
          notes: body.notes ?? null,
          // No automatic grading or pricing anywhere — quoted_amount stays null
          // until a person sets it (POST /requests/:id/quote below).
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return (await loadSellRequest(id))!;
    });

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json(toApiSellRequest(row));
  },
);

/**
 * A queue row deliberately omits `condition` — the intake jsonb (storage,
 * screen, body, powers-on, network, accessories) is inspection detail for one
 * request, not something the queue lists or filters on. `GET /requests/:id`
 * returns it when a member of staff actually opens the request.
 */
function sellQueue() {
  return db
    .selectFrom('sell_requests')
    .leftJoin('devices', 'devices.id', 'sell_requests.device_id')
    .select([
      'sell_requests.id',
      'sell_requests.reference',
      'sell_requests.customer_id',
      'sell_requests.name',
      'sell_requests.phone',
      'sell_requests.email',
      'sell_requests.preferred_contact',
      'sell_requests.device_id',
      'sell_requests.device_other',
      'sell_requests.status',
      'sell_requests.quoted_amount',
      'sell_requests.quoted_by',
      'sell_requests.quoted_at',
      'sell_requests.notes',
      'sell_requests.created_at',
      'sell_requests.updated_at',
      'devices.name as device_name',
    ]);
}

type SellListFilters = { status?: string[]; search?: string; shopId?: string | null };

/** The filter half of the queue query, shared by the page and its count. */
function sellFilters({ status, search, shopId }: SellListFilters) {
  return (eb: ExpressionBuilder<DB, 'sell_requests'>) => {
    const conditions: Expression<SqlBool>[] = [];
    if (shopId) conditions.push(eb('sell_requests.shop_id', '=', shopId));
    if (status && status.length > 0) {
      conditions.push(eb('sell_requests.status', 'in', status as SellRequestStatus[]));
    }
    // Wildcards stripped so a search term is only ever a literal substring
    // (commas too, as they were once filter separators here).
    const term = search?.replace(/[%_,]/g, '');
    if (term) {
      const like = `%${term}%`;
      conditions.push(
        eb.or([
          eb('sell_requests.reference', 'ilike', like),
          eb('sell_requests.name', 'ilike', like),
          eb('sell_requests.email', 'ilike', like),
          eb('sell_requests.device_other', 'ilike', like),
        ]),
      );
    }
    return eb.and(conditions);
  };
}

/** A sell request / payout belongs to the shop that handles it; the rest of the caller's reach follows from that. */
function guardByShop(table: 'sell_requests' | 'trade_in_payouts') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || req.user.kind !== 'staff' || !isUuidValue(req.params.id)) return next();
    const row = await db
      .selectFrom(table)
      .select('shop_id')
      .where('id', '=', req.params.id)
      .executeTakeFirst();
    if (!row) return next();
    const allowed = req.method === 'GET' ? canRead(req, row.shop_id) : canWrite(req, row.shop_id);
    if (!allowed) return res.status(404).json({ error: 'Not found.' });
    next();
  };
}
sellRouter.use('/requests/:id', guardByShop('sell_requests'));
sellRouter.use('/payouts/:id', guardByShop('trade_in_payouts'));

sellRouter.get('/requests', requireStaff, requirePermission('tradein.manage'), async (req, res) => {
  const parsed = sellRequestListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { status, search, sort, limit, offset } = parsed.data;
  const filters: SellListFilters = { status, search, shopId: readShop(req) };

  let query = sellQueue().where(sellFilters(filters));

  if (sort === 'created-asc') query = query.orderBy('sell_requests.created_at', 'asc');
  else if (sort === 'updated-desc') query = query.orderBy('sell_requests.updated_at', 'desc');
  else query = query.orderBy('sell_requests.created_at', 'desc');

  const { data, error } = await attempt(() =>
    Promise.all([
      query.limit(limit).offset(offset).execute(),
      db
        .selectFrom('sell_requests')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where(sellFilters(filters))
        .executeTakeFirstOrThrow(),
    ]),
  );
  if (error) return res.status(500).json({ error: 'Could not load sell requests.' });

  const [rows, { count }] = data;
  return res.json(page(rows.map(toApiSellRequest), count, limit, offset));
});

sellRouter.get(
  '/requests/:id',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const id = req.params.id ?? '';
    const row = isUuid(id) ? await loadSellRequest(id) : undefined;
    if (!row) return res.status(404).json({ error: 'Sell request not found.' });
    return res.json(toApiSellRequest(row));
  },
);

/** Sets the quote AND moves status to 'quoted' in one call — always a person, never derived. */
sellRouter.post(
  '/requests/:id/quote',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const parsed = sellQuoteBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { data: row, error } = await attempt(async () => {
      const updated = await db
        .updateTable('sell_requests')
        .set({
          quoted_amount: parsed.data.amount,
          quoted_by: req.user!.id,
          quoted_at: new Date().toISOString(),
          status: 'quoted',
        })
        .where('id', '=', req.params.id ?? '')
        .returning('id')
        .executeTakeFirst();
      return updated ? loadSellRequest(updated.id) : undefined;
    });

    if (error) return res.status(409).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Sell request not found.' });
    return res.json(toApiSellRequest(row));
  },
);

/**
 * Staff-driven status moves (accept on the customer's behalf, decline, mark received, reject) —
 * the schema's own transition guard enforces legality, and sellStatusBodySchema documents why
 * 'paid' is not one of them.
 */
sellRouter.post(
  '/requests/:id/status',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const parsed = sellStatusBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { data: row, error } = await attempt(async () => {
      const updated = await db
        .updateTable('sell_requests')
        .set({ status: parsed.data.status })
        .where('id', '=', req.params.id ?? '')
        .returning('id')
        .executeTakeFirst();
      return updated ? loadSellRequest(updated.id) : undefined;
    });

    if (error) return res.status(409).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Sell request not found.' });
    return res.json(toApiSellRequest(row));
  },
);

/* ---------------------------------------------------------------------- */
/* Guest-safe acceptance — single-use signed token                          */
/* ---------------------------------------------------------------------- */

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function acceptanceEmailHtml(
  customerName: string,
  url: string,
  expiresAt: string,
  offer: { amount: number; reference: string; device: string | null },
): string {
  // Matches the plain, no-frills style already used for the acceptance
  // screen itself (sell-accept.tsx) — no separate "marketing" template
  // system exists anywhere in this codebase to diverge from.
  const expiry = new Date(expiresAt).toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  });
  return `
    <p>Hi ${escapeHtml(customerName)},</p>
    <p>Your trade-in quote is ready: we can offer <strong>${formatPence(offer.amount)}</strong>${
      offer.device ? ` for your ${escapeHtml(offer.device)}` : ''
    } (reference ${escapeHtml(offer.reference)}).</p>
    <p>Follow the link below to accept it and arrange sending your device in:</p>
    <p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
    <p>This link works once and expires ${expiry}.</p>
    <p>Fonology</p>
  `;
}

/**
 * Staff/system issues an acceptance link after quoting. Returns the
 * plaintext token ONCE — only its hash is ever stored, here or anywhere
 * downstream. Also emails the link automatically via Brevo; the manual
 * copy-paste flow already in the admin screen stays as a fallback, so an
 * email failure never leaves staff with nothing they can hand the customer.
 *
 * The token appears in exactly two places: this one-time API response, and
 * the body of the one email sent here. Nothing logs it, including the email
 * lib's own error path (see lib/email.ts) — a failed send is reported by
 * status code, never by echoing what was being sent.
 */
sellRouter.post(
  '/requests/:id/accept-token',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const sellRequestId = req.params.id ?? '';
    if (!isUuid(sellRequestId)) return res.status(404).json({ error: 'Sell request not found.' });

    const request = await db
      .selectFrom('sell_requests as s')
      .leftJoin('devices as d', 'd.id', 's.device_id')
      .select([
        's.name',
        's.email',
        's.reference',
        's.status',
        's.quoted_amount',
        's.device_other',
        'd.name as device_name',
      ])
      .where('s.id', '=', sellRequestId)
      .executeTakeFirst();
    if (!request) return res.status(404).json({ error: 'Sell request not found.' });
    // The link asks the customer to accept a price, and redeeming it only moves
    // a 'quoted' request on. Issuing one before there is a quote produced a link
    // (and an email) with nothing to accept.
    if (request.status !== 'quoted' || request.quoted_amount == null) {
      return res.status(409).json({
        error:
          request.quoted_amount == null
            ? 'Save a quote before sending an acceptance link.'
            : 'This request has already moved on from its quote — there is nothing left to accept.',
      });
    }

    const { error } = await attempt(() =>
      db
        .insertInto('sell_request_acceptance_tokens')
        .values({
          sell_request_id: sellRequestId,
          token_hash: hashToken(token),
          expires_at: expiresAt,
        })
        .execute(),
    );
    if (error) return res.status(400).json({ error: error.message });

    let emailSent = false;
    if (request.email) {
      const url = `${config.webAppUrl}/sell/accept?token=${encodeURIComponent(token)}`;
      const result = await sendTransactionalEmail({
        to: { email: request.email, name: request.name },
        subject: 'Your Fonology trade-in quote is ready',
        htmlContent: acceptanceEmailHtml(request.name || 'there', url, expiresAt, {
          amount: request.quoted_amount,
          reference: request.reference,
          device: request.device_name ?? request.device_other ?? null,
        }),
      });
      emailSent = result.sent;
    }

    // The only response that ever carries the plaintext token — the manual
    // copy-paste path in the admin screen still works from this regardless
    // of whether emailSent is true.
    return res.status(201).json({ token, expiresAt, emailSent });
  },
);

/** Guest-facing: redeem the token from the acceptance link. No auth — the token itself is the proof of identity. */
/**
 * What the customer is about to accept — read-only, the token is NOT spent.
 *
 * The acceptance page used to ask "happy with the price we quoted?" without
 * ever showing the price (the email doesn't carry it either), so the first time
 * a customer saw the figure was after they had already accepted it. This returns
 * only what that page needs: no name, phone or email, because a forwarded link
 * should not hand those to whoever opens it. Invalid, expired and used links
 * fail with the same wording as /accept, for the same reason.
 */
sellRouter.post('/accept/preview', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : null;
  if (!token) return res.status(400).json({ error: 'A token is required.' });

  const { data: row, error } = await attempt(() =>
    db
      .selectFrom('sell_request_acceptance_tokens as t')
      .innerJoin('sell_requests as s', 's.id', 't.sell_request_id')
      .leftJoin('devices as d', 'd.id', 's.device_id')
      .select([
        's.reference',
        's.quoted_amount',
        's.status',
        's.device_other',
        'd.name as device_name',
        't.expires_at',
      ])
      .where('t.token_hash', '=', hashToken(token))
      .where('t.used_at', 'is', null)
      .where('t.expires_at', '>', new Date().toISOString())
      .executeTakeFirst(),
  );
  if (error) return res.status(500).json({ error: 'Could not process this link.' });
  if (!row || row.status !== 'quoted' || row.quoted_amount == null) {
    return res
      .status(400)
      .json({ error: 'This link is invalid, expired, or has already been used.' });
  }
  return res.json({
    reference: row.reference,
    deviceName: row.device_name ?? row.device_other ?? null,
    quotedAmount: row.quoted_amount,
    expiresAt: row.expires_at,
  });
});

sellRouter.post('/accept', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : null;
  if (!token) return res.status(400).json({ error: 'A token is required.' });

  const { data: sellRequestId, error } = await attempt(() =>
    rpc<string | null>('redeem_sell_acceptance_token', { p_token_hash: hashToken(token) }),
  );
  if (error) return res.status(500).json({ error: 'Could not process this link.' });
  if (!sellRequestId) {
    return res
      .status(400)
      .json({ error: 'This link is invalid, expired, or has already been used.' });
  }

  const row = await loadSellRequest(sellRequestId);
  return res.json(toApiSellRequest(row!));
});

/* ---------------------------------------------------------------------- */
/* Payout — money OUT, excluded from revenue                                */
/* ---------------------------------------------------------------------- */

sellRouter.post(
  '/requests/:id/payout',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const parsed = sellPayoutBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    // The cash leaves the paying shop's drawer.
    const payoutShop = await writeShop(req, res);
    if (!payoutShop) return;

    const { data: row, error } = await attempt(() =>
      db
        .insertInto('trade_in_payouts')
        .values({
          shop_id: payoutShop,
          sell_request_id: req.params.id ?? '',
          device_label: body.deviceLabel,
          customer_name: body.customerName,
          // Stored negative — money OUT — enforced by the schema's own
          // `amount < 0` CHECK; the client sends a positive "what we paid"
          // figure (matches the mock's tradeInPayoutInputSchema, which is
          // always positive too) and this is the one place it gets negated.
          amount: -body.amount,
          method: body.method,
          staff_id: req.user!.id,
          notes: body.notes ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({
      id: row.id,
      reference: row.reference,
      sellRequestId: row.sell_request_id,
      deviceLabel: row.device_label,
      customerName: row.customer_name,
      amount: row.amount,
      method: row.method,
      staffId: row.staff_id,
      notes: row.notes,
      restocked: row.restocked,
      createdAt: row.created_at,
    });
  },
);

/** Walk-in buy-in — no prior sell_request. Same payout table, sell_request_id null. */
sellRouter.post('/payouts', requireStaff, requirePermission('tradein.manage'), async (req, res) => {
  const parsed = sellPayoutBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;
  const payoutShop = await writeShop(req, res);
  if (!payoutShop) return;

  const { data: row, error } = await attempt(() =>
    db
      .insertInto('trade_in_payouts')
      .values({
        shop_id: payoutShop,
        device_label: body.deviceLabel,
        customer_name: body.customerName,
        amount: -body.amount,
        method: body.method,
        staff_id: req.user!.id,
        notes: body.notes ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json({
    id: row.id,
    reference: row.reference,
    sellRequestId: row.sell_request_id,
    deviceLabel: row.device_label,
    customerName: row.customer_name,
    amount: row.amount,
    method: row.method,
    staffId: row.staff_id,
    createdAt: row.created_at,
  });
});

/**
 * The payout ledger — money the shop has paid OUT for devices.
 *
 * There was no way to READ these: only the two POSTs above existed, so a
 * payout could be recorded and then never listed. Amounts come back exactly
 * as stored, which is NEGATIVE — this is money out, and it is deliberately not
 * flipped to a friendly positive on the way through. `BUY-` references and
 * exclusion from every revenue figure are the schema's doing, not this
 * endpoint's.
 *
 * Staff names are resolved here rather than left as bare ids: shipping only
 * `staffId` is what broke the cash screen, where the frontend expected a name
 * and the parse threw.
 */
function toApiPayout(row: Record<string, unknown>, staffNames: Map<string, string>) {
  return {
    id: row.id,
    reference: row.reference,
    sellRequestId: row.sell_request_id,
    deviceLabel: row.device_label,
    customerName: row.customer_name,
    /** Negative. Money out. */
    amount: row.amount,
    method: row.method,
    staffId: row.staff_id,
    staffName: row.staff_id ? (staffNames.get(row.staff_id as string) ?? null) : null,
    notes: row.notes ?? null,
    restocked: row.restocked,
    resalePrice: row.resale_price ?? null,
    restockedProductId: row.restocked_product_id ?? null,
    createdAt: row.created_at,
  };
}

sellRouter.get('/payouts', requireStaff, requirePermission('tradein.manage'), async (req, res) => {
  const parsed = payoutListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { restocked, sellRequestId, search, limit, offset } = parsed.data;
  const payoutsShop = readShop(req);

  const filter = <O>(q: SelectQueryBuilder<DB, 'trade_in_payouts', O>) => {
    if (payoutsShop) q = q.where('shop_id', '=', payoutsShop);
    if (restocked !== undefined) q = q.where('restocked', '=', restocked);
    if (sellRequestId) q = q.where('sell_request_id', '=', sellRequestId);
    if (search) {
      // Same wildcard stripping as the request queue.
      const term = search.replace(/[%_,]/g, '');
      if (term) {
        const like = `%${term}%`;
        q = q.where((eb) =>
          eb.or([
            eb('reference', 'ilike', like),
            eb('device_label', 'ilike', like),
            eb('customer_name', 'ilike', like),
          ]),
        );
      }
    }
    return q;
  };

  const { data, error } = await attempt(() =>
    Promise.all([
      filter(db.selectFrom('trade_in_payouts').selectAll())
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      filter(
        db.selectFrom('trade_in_payouts').select((eb) => eb.fn.countAll<number>().as('count')),
      ).executeTakeFirstOrThrow(),
    ]),
  );
  if (error) return res.status(500).json({ error: 'Could not load payouts.' });

  const [rows, { count }] = data;
  const names = await staffNamesFor(rows.map((r) => r.staff_id));
  return res.json(
    page(
      rows.map((r) => toApiPayout(r, names)),
      count,
      limit,
      offset,
    ),
  );
});

/* ---------------------------------------------------------------------- */
/* Restock — manual, staff-priced, never automatic                          */
/* ---------------------------------------------------------------------- */

sellRouter.post(
  '/payouts/:id/restock',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const parsed = restockBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    // withActor: the new product's 'created' row in the change log (0104) carries who listed it.
    const { data: productId, error } = await attempt(() =>
      withActor(req.user!.id, (trx) =>
        rpc<string>(
          'restock_trade_in',
          {
            p_payout_id: req.params.id,
            p_name: body.name,
            // categories.id — restock_trade_in's p_category_id parameter as of
            // migration 0045 (was an enum parameter).
            p_category_id: body.categoryId,
            p_resale_price: body.resalePrice,
            p_kind: 'accessory',
            p_staff_id: req.user!.id,
            // Item 11. Normalised inside the function (digits and letters only) so
            // a later lookup is not defeated by whichever spacing it was typed in.
            p_imei: body.imei ?? null,
          },
          { executor: trx },
        ),
      ),
    );
    if (error) return res.status(409).json({ error: error.message });

    const { data: product, error: productErr } = await attempt(() =>
      db
        .selectFrom('products')
        .select(['id', 'slug', 'name', 'price', 'cost_price', 'stock_qty'])
        .where('id', '=', productId)
        .executeTakeFirst(),
    );
    if (productErr || !product)
      return res.status(500).json({ error: 'Restocked, but could not load the new product.' });
    return res.status(201).json({
      id: product.id,
      slug: product.slug,
      name: product.name,
      price: product.price,
      costPrice: product.cost_price,
      stockQty: product.stock_qty,
    });
  },
);
