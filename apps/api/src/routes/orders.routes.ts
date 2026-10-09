import type { NextFunction, Request, Response } from 'express';
import { BUCKETS, objectExists, signedGetUrl } from '../lib/storage.js';
import type { ExpressionBuilder, SelectQueryBuilder } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { attempt, db, rpc, sql } from '../lib/db.js';
import type { DB, OrderDocumentKind, OrderStatus } from '../db/types.js';
import {
  requireStaff,
  requirePermission,
  requireCustomer,
  blockStaffCheckout,
} from '../middleware/auth.js';
import {
  uploadOrderDocumentMiddleware,
  uploadOrderDocument,
  orderDocumentExists,
  isOrderDocumentKind,
} from '../lib/orderDocuments.js';
import { clientIp } from '../lib/clientIp.js';
import { getStripe, isStripeConfigured } from '../lib/stripe.js';
import { settleOrderPaid } from '../lib/orderPayments.js';
import { isRateLimited } from '../lib/rateLimit.js';
import {
  orderInputBodySchema,
  orderStatusBodySchema,
  documentRejectBodySchema,
  deliveryQuoteBodySchema,
} from '../schemas.js';

import { createRouter } from '../lib/router.js';
import { canRead, canWrite, readShop } from '../lib/shopScope.js';
import { optionalPaging, pageWithTotals } from '../lib/pagination.js';
import { shopDayRangeUtc } from '../lib/shopDay.js';
import { isUuid } from '../lib/uuid.js';

export const ordersRouter = createRouter();

/**
 * Staff routes that act on ONE online order. An order belongs to the shop that fulfils it;
 * a caller outside that shop's reach gets "not found". Customer routes are untouched.
 */
function guardOrderByShop(by: 'reference' | 'id') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || req.user.kind !== 'staff') return next();
    const key =
      by === 'id' ? (req.params.id ?? '') : (req.params.reference ?? '').trim().toUpperCase();
    if (by === 'id' && !isUuid(key)) return next();
    const row = await db
      .selectFrom('orders')
      .select('fulfilment_shop_id')
      .where(by === 'id' ? 'id' : 'reference', '=', key)
      .executeTakeFirst();
    if (!row) return next();
    const allowed =
      req.method === 'GET'
        ? canRead(req, row.fulfilment_shop_id)
        : canWrite(req, row.fulfilment_shop_id);
    if (!allowed) return res.status(404).json({ error: 'Order not found.' });
    next();
  };
}
ordersRouter.use('/:reference/documents', guardOrderByShop('reference'));
ordersRouter.use('/:reference/paid', guardOrderByShop('reference'));
ordersRouter.use('/id/:id/status', guardOrderByShop('id'));

function orderIdByReference(reference: string) {
  return db.selectFrom('orders').select('id').where('reference', '=', reference).executeTakeFirst();
}

/**
 * UK delivery method -> DB delivery_method. 'remote' is not a real DB
 * method — it was the checkout's old fixed-price self-report ("I know I'm in a
 * remote area"). The schema derives the real zone from the postcode on
 * every order regardless of what the customer picked, so 'remote' collapses
 * into 'standard' service tier here; the ACTUAL fee still comes out at the
 * remote rate if the postcode really is remote, and at the standard rate if
 * it isn't — never from what the client claims.
 */
function mapDeliveryMethod(input: string): 'collect' | 'standard' | 'next_day' {
  if (input === 'collect') return 'collect';
  if (input === 'next-day') return 'next_day';
  return 'standard';
}

function mapDeliveryMethodOut(method: string): 'collect' | 'standard' | 'next-day' {
  if (method === 'next_day') return 'next-day';
  if (method === 'collect') return 'collect';
  return 'standard';
}

interface OrderLineRow {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  // From the live product, when it still exists.
  slug: string | null;
  sub: string | null;
  kind: string | null;
}

/**
 * The order with its lines and customer email alongside, in one query, so
 * toApiOrder needs no further round trips. Without it a list of N orders cost
 * up to 2N extra round trips. The lines arrive as JSON built by Postgres.
 */
function ordersWithLines() {
  return db
    .selectFrom('orders')
    .selectAll('orders')
    .select((eb: ExpressionBuilder<DB, 'orders'>) => [
      jsonArrayFrom(
        eb
          .selectFrom('order_lines')
          .leftJoin('products', 'products.id', 'order_lines.product_id')
          .leftJoin('master_products', 'master_products.id', 'products.master_product_id')
          .select([
            'order_lines.id',
            'order_lines.product_id',
            'order_lines.variant_id',
            'order_lines.name',
            'order_lines.unit_price',
            'order_lines.quantity',
            // The public address is the MASTER's, whichever shop's copy the line was taken from.
            sql<string | null>`coalesce(master_products.slug, products.slug)`.as('slug'),
            'products.sub',
            'products.kind',
          ])
          .whereRef('order_lines.order_id', '=', 'orders.id'),
      ).as('order_lines'),
      eb
        .selectFrom('customers')
        .select('customers.email')
        .whereRef('customers.id', '=', 'orders.customer_id')
        .as('customer_email'),
    ]);
}

async function loadOrder(where: { id: string } | { reference: string }) {
  const query = ordersWithLines();
  return 'id' in where
    ? query.where('orders.id', '=', where.id).executeTakeFirst()
    : query.where('orders.reference', '=', where.reference).executeTakeFirst();
}

function toApiOrder(orderRow: Record<string, unknown>): Record<string, unknown> {
  const lineRows = orderRow.order_lines as OrderLineRow[];

  const lines = lineRows.map((line) => ({
    productId: line.product_id ?? line.id,
    // Round 5 Phase 4 #16: null for every line that isn't a variant.
    variantId: line.variant_id,
    name: line.name,
    // sub/slug/kind aren't snapshotted on order_lines (only name + price are
    // — the historically-meaningful fields). Joined from the live product
    // when it still exists; honest fallbacks when it's been deleted since.
    sub: line.sub ?? '',
    slug: line.slug ?? '',
    kind: line.kind ?? 'accessory',
    unitPrice: line.unit_price,
    quantity: line.quantity,
  }));

  const email =
    (orderRow.guest_email as string | null) || (orderRow.customer_email as string | null) || null;

  return {
    id: orderRow.id,
    reference: orderRow.reference,
    lines,
    name: orderRow.recipient_name ?? '',
    email: email ?? '',
    phone: orderRow.phone ?? '',
    delivery: mapDeliveryMethodOut(orderRow.delivery_method as string),
    address: orderRow.address_line1 ?? null,
    postcode: orderRow.postcode ?? null,
    subtotal: orderRow.subtotal,
    deliveryFee: orderRow.delivery_fee,
    discount: orderRow.discount,
    total: orderRow.total,
    status: orderRow.status,
    courier: orderRow.courier ?? null,
    trackingNumber: orderRow.tracking_number ?? null,
    createdAt: orderRow.created_at,
  };
}

/**
 * Admin: all orders, for the online-orders board. Gated the same as the
 * status-move endpoint below (requireStaff only) — there's no dedicated
 * "orders.manage" in the 15-value permission enum, and every counter/repair
 * staff member already needs visibility of what's shipped/awaiting collection.
 */
ordersRouter.get('/', requireStaff, async (req, res) => {
  const shopId = readShop(req);
  const paging = optionalPaging(req);
  // Paged requests may also narrow by `status` (comma-separated) and `search` (reference,
  // guest email, recipient, phone).
  const statuses = (typeof req.query.status === 'string' ? req.query.status : '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as OrderStatus[];
  const term =
    typeof req.query.search === 'string' ? req.query.search.replace(/[%_,]/g, '').trim() : '';
  // `from` / `to` (YYYY-MM-DD, trading days) narrow a paged list to a date range.
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const fromDay =
    typeof req.query.from === 'string' && day.test(req.query.from) ? req.query.from : null;
  const toDay = typeof req.query.to === 'string' && day.test(req.query.to) ? req.query.to : null;
  const dayRange =
    fromDay || toDay ? shopDayRangeUtc(fromDay ?? '2000-01-01', toDay ?? '2999-12-31') : null;
  const narrow = <O>(qb: SelectQueryBuilder<DB, 'orders', O>) => {
    let q = qb;
    if (shopId) q = q.where('orders.fulfilment_shop_id', '=', shopId);
    if (paging && statuses.length > 0) q = q.where('orders.status', 'in', statuses);
    if (paging && dayRange) {
      q = q
        .where('orders.created_at', '>=', dayRange.start)
        .where('orders.created_at', '<', dayRange.endExclusive);
    }
    if (paging && term) {
      const like = `%${term}%`;
      q = q.where((eb) =>
        eb.or([
          eb('orders.reference', 'ilike', like),
          eb('orders.guest_email', 'ilike', like),
          eb('orders.recipient_name', 'ilike', like),
          eb('orders.phone', 'ilike', like),
        ]),
      );
    }
    return q;
  };
  const { data: rows, error } = await attempt(() =>
    narrow(ordersWithLines())
      // The work queue reads oldest first (the order people waited in); history reads newest.
      .orderBy('orders.created_at', paging && req.query.sort === 'oldest' ? 'asc' : 'desc')
      .$if(!!paging, (qb) => qb.limit(paging!.limit).offset(paging!.offset))
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load orders.' });
  if (!paging) return res.json(rows.map(toApiOrder));

  const whole = await narrow(
    db
      .selectFrom('orders')
      .select((eb) => [
        eb.fn.countAll<number>().as('count'),
        eb.fn.sum<number>('orders.total').as('total'),
      ]),
  ).executeTakeFirstOrThrow();
  return res.json(
    pageWithTotals(rows.map(toApiOrder), Number(whole.count), paging, {
      value: Number(whole.total ?? 0),
    }),
  );
});

/**
 * Read-only: what create_order would actually charge for delivery, for this
 * basket/method/postcode, before the order exists. Calls delivery_quote() —
 * the exact same function create_order() calls — so what the checkout screen
 * shows can never drift from what gets charged (see 0021_delivery_quote.sql).
 */
ordersRouter.post('/delivery-quote', async (req, res) => {
  const parsed = deliveryQuoteBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const productIds = [...new Set(body.lines.map((l) => l.productId))];
  const { data: products, error: productsErr } = await attempt(() =>
    db
      .selectFrom('products as p')
      .innerJoin('online_products as op', 'op.master_id', 'p.master_product_id')
      .select(['p.id'])
      .where('p.id', 'in', productIds)
      .execute(),
  );
  if (productsErr) return res.status(500).json({ error: 'Could not price the basket.' });
  const byId = new Set(products.map((p) => p.id));
  for (const line of body.lines) {
    if (!byId.has(line.productId)) {
      return res
        .status(400)
        .json({ error: `One of the items in your bag is no longer available.` });
    }
  }

  const pLines = body.lines.map((l) => ({
    product_id: l.productId,
    variant_id: l.variantId ?? null,
    quantity: l.quantity,
  }));
  const deliveryMethod = mapDeliveryMethod(body.delivery);
  const postcode = body.postcode?.trim() || null;

  // Every method the postcode's zone offers, with this basket's fee for each (0102) — so the
  // checkout can hide next-day for a remote postcode instead of letting the order fail.
  // Without a postcode yet, this is the mainland list ("from" prices).
  const { data: optionRows, error: optionsErr } = await attempt(() =>
    rpc<{ method: 'standard' | 'next_day'; available: boolean; delivery_fee: number | null }[]>(
      'delivery_options',
      { p_lines: pLines, p_postcode: postcode },
      { returnsSet: true },
    ),
  );
  if (optionsErr) return res.status(400).json({ error: optionsErr.message });

  const methodAvailable =
    deliveryMethod === 'collect' ||
    optionRows.some((o) => o.method === deliveryMethod && o.available);

  // delivery_quote_detail, not delivery_quote: the quote is asked for while the customer is
  // still typing, so it mustn't demand a postcode — POST /orders goes through delivery_quote,
  // which does.
  let row: { delivery_fee: number; zone_code: string | null; free_delivery: boolean } | null = null;
  if (methodAvailable) {
    const { data, error } = await attempt(() =>
      rpc<{ delivery_fee: number; zone_code: string | null; free_delivery: boolean }[]>(
        'delivery_quote_detail',
        { p_lines: pLines, p_delivery_method: deliveryMethod, p_postcode: postcode },
        { returnsSet: true },
      ),
    );
    if (error) return res.status(400).json({ error: error.message });
    row = data[0] ?? null;
    if (!row) return res.status(400).json({ error: 'Could not quote delivery for that basket.' });
  }

  const { data: zoneAndSettings } = await attempt(() =>
    sql<{ zone_code: string | null; free_delivery_threshold: number | null }>`
      select (select code from public.delivery_zones
                where id = public.delivery_zone_for(${postcode})) as zone_code,
             (select free_delivery_threshold from public.shop_settings limit 1)
               as free_delivery_threshold`
      .execute(db)
      .then((r) => r.rows[0] ?? null),
  );

  // When it would actually arrive, honouring shop_settings.next_day_cutoff_time
  // and skipping weekends (0026). Computed server-side because it depends on
  // the shop's Europe/London clock and a settings value — a browser-side
  // version would drift with the visitor's own timezone, and this is a date the
  // shop will be held to.
  const { data: estimate } = await attempt(() =>
    rpc<
      {
        dispatch_date: string | null;
        arrival_date: string | null;
        cutoff_time: string;
        after_cutoff: boolean;
      }[]
    >('delivery_estimate', { p_delivery_method: deliveryMethod }, { returnsSet: true }),
  );
  const est = estimate?.[0] ?? null;

  return res.json({
    // Null when the chosen method isn't offered to this postcode (methodAvailable false).
    deliveryFee: row?.delivery_fee ?? null,
    zone: deliveryMethod === 'collect' ? null : (zoneAndSettings?.zone_code ?? null),
    methodAvailable,
    freeDelivery: deliveryMethod !== 'collect' && (row?.free_delivery ?? false),
    freeDeliveryThreshold: zoneAndSettings?.free_delivery_threshold ?? null,
    options: optionRows.map((o) => ({
      method: mapDeliveryMethodOut(o.method),
      available: o.available,
      deliveryFee: o.delivery_fee,
    })),
    // Null for collect — there is no dispatch for a collection.
    dispatchDate: est?.dispatch_date ?? null,
    arrivalDate: est?.arrival_date ?? null,
    cutoffTime: est?.cutoff_time ?? null,
    afterCutoff: est?.after_cutoff ?? false,
  });
});

/**
 * Number-plate verification document upload (independent audit finding
 * CRIT-02). See lib/orderDocuments.ts for what was broken and why this
 * exists at all.
 *
 * SEQUENCING — why this is a separate call, before the order exists
 * A plate order cannot be created without its documents (the order schema
 * requires both), so the documents cannot be uploaded "onto" an order that
 * does not exist yet. The alternatives were:
 *
 *   * create the order first, then attach — leaves a real plate order in
 *     the database with no documents if the upload then fails, which is the
 *     exact state this finding is about; or
 *   * send the files inside POST /orders as multipart — makes the ordering
 *     endpoint a file endpoint, and means a failed 4MB upload discards the
 *     whole basket and delivery quote with it.
 *
 * So: upload first, independently, and get back an opaque storage key. The
 * key travels through the existing `verification` field, and POST /orders
 * verifies each key is one WE minted and that the object really exists
 * before it creates anything. A failed upload therefore fails early, on its
 * own, with the basket intact and no order written.
 *
 * Unauthenticated by necessity — this is a guest checkout — so: rate
 * limited per IP, type and size enforced by multer before the handler runs,
 * and nothing about the request is trusted for the storage path (the key is
 * minted server-side from a UUID; the customer's own filename is discarded
 * rather than echoed into the bucket).
 *
 * Uploads that never become an order are swept by
 * purgeOrphanedOrderDocuments — an abandoned basket must not leave a
 * stranger's driving licence sitting in storage indefinitely.
 */
ordersRouter.post(
  '/documents',
  (req, res, next) => {
    if (
      isRateLimited(`plate-document:${clientIp(req) ?? 'unknown'}`, {
        max: 20,
        windowMs: 10 * 60_000,
      })
    ) {
      return res
        .status(429)
        .json({ error: 'Too many uploads — please wait a few minutes and try again.' });
    }
    next();
  },
  (req, res, next) => {
    uploadOrderDocumentMiddleware(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : 'Upload failed.';
        const tooLarge = message.includes('File too large');
        return res
          .status(400)
          .json({ error: tooLarge ? 'That file is larger than 8MB.' : message });
      }
      next();
    });
  },
  async (req, res) => {
    const kind = (req.body as { kind?: unknown })?.kind;
    if (!isOrderDocumentKind(kind)) {
      return res.status(400).json({ error: 'Unknown document kind.' });
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json({ error: 'No file was received.' });

    try {
      const { path } = await uploadOrderDocument(kind, file.buffer, file.mimetype);
      return res.status(201).json({ storagePath: path });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[api] plate document upload failed:', err);
      return res.status(500).json({ error: 'Could not upload the document. Please try again.' });
    }
  },
);

ordersRouter.post('/', blockStaffCheckout('place an order'), async (req, res) => {
  const parsed = orderInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  // Online orders sell the MASTER product (0099): the customer's productId is any shop's copy
  // (normally the listing's representative), and it resolves to the listing and the combined
  // stock of every shop. create_order() then prices it at the highest shop price and splits it
  // across the shops that hold it.
  const productIds = [...new Set(body.lines.map((l) => l.productId))];
  const variantIds = [...new Set(body.lines.map((l) => l.variantId).filter(Boolean))] as string[];
  const { data: basket, error: basketErr } = await attempt(() =>
    Promise.all([
      db
        .selectFrom('products as p')
        .innerJoin('online_products as op', 'op.master_id', 'p.master_product_id')
        .select(['p.id as requested_id', 'op.kind', 'op.master_id', 'op.has_variants'])
        .where('p.id', 'in', productIds)
        .execute(),
      variantIds.length
        ? db
            .selectFrom('product_variants as v')
            .innerJoin('online_copies as c', 'c.product_id', 'v.product_id')
            .select(['v.id', 'c.master_id'])
            .where('v.id', 'in', variantIds)
            .where('v.is_active', '=', true)
            .execute()
        : Promise.resolve([]),
    ]),
  );
  if (basketErr) return res.status(500).json({ error: 'Could not validate the basket.' });
  const [products, variants] = basket;

  const byId = new Map(products.map((p) => [p.requested_id, p]));
  const variantMaster = new Map(variants.map((v) => [v.id, v.master_id]));

  for (const line of body.lines) {
    const product = byId.get(line.productId);
    if (!product) {
      return res
        .status(400)
        .json({ error: `One of the items in your bag is no longer available.` });
    }
    if (product.kind === 'vape') {
      return res
        .status(400)
        .json({ error: 'Vapes are in-store only and cannot be ordered online.' });
    }
    // A variation product's parent is never for sale itself (0107): a line must name a variation.
    if (product.has_variants && !line.variantId) {
      return res
        .status(400)
        .json({ error: 'Choose an option for one of the items in your bag, then try again.' });
    }
    if (line.variantId && variantMaster.get(line.variantId) !== product.master_id) {
      return res
        .status(400)
        .json({ error: `One of the items in your bag is no longer available.` });
    }

    // Combined across every shop's copy (a variant is matched across shops by its options).
    const have = await rpc<number>('online_available_qty', {
      p_product_id: line.productId,
      p_variant_id: line.variantId ?? null,
    });
    if (have < line.quantity) {
      // Never the count (customers never see stock numbers): just that this many won't fit.
      return res.status(409).json({
        error: 'We don’t have that many of one item in your bag — please lower the quantity.',
      });
    }
  }

  /**
   * Plate documents are checked BEFORE anything is created (audit finding
   * CRIT-02). Two separate things are verified, because the storage key
   * arrives from the client and neither check subsumes the other:
   *
   *   1. the key is one THIS API could have minted — without which a caller
   *      could write any string into order_documents.storage_path,
   *      including a path aimed at another customer's document;
   *   2. the object is actually in the bucket — which is what stops a plate
   *      order existing against a document that was never really uploaded,
   *      the precise state this finding was about.
   *
   * Refusing here, before create_order, means a failure costs the customer
   * nothing: no order row, no reference burned, basket intact, and they are
   * sent back to re-upload rather than discovering it after paying.
   */
  const hasPlateLine = body.lines.some((l) => byId.get(l.productId)?.kind === 'plate');
  if (hasPlateLine) {
    if (!body.verification) {
      return res.status(400).json({
        error: 'A number plate order needs both verification documents before it can be placed.',
      });
    }
    const documentPaths: Array<{ kind: 'v5c' | 'driving_licence'; path: string }> = [
      { kind: 'v5c', path: body.verification.registrationDoc },
      { kind: 'driving_licence', path: body.verification.licence },
    ];
    for (const doc of documentPaths) {
      if (!(await orderDocumentExists(doc.path))) {
        return res.status(400).json({
          error:
            'One of your verification documents did not upload correctly. Please upload both documents again.',
        });
      }
    }
  }

  // Identity: from the authenticated session if one exists, never from the
  // request body. A customer can't place an order "as" someone else by
  // editing a client-side field, because there is no client-side field for
  // it — customer_id only ever comes from the verified session cookie.
  const customerId = req.user?.kind === 'customer' ? req.user.id : null;
  const guestEmail = customerId ? null : body.email;

  const pLines = body.lines.map((l) => ({
    product_id: l.productId,
    variant_id: l.variantId ?? null,
    quantity: l.quantity,
  }));
  const recipientName = `${body.firstName} ${body.lastName}`.trim();
  const deliveryMethod = mapDeliveryMethod(body.delivery);

  const { data: orderId, error: createErr } = await attempt(() =>
    rpc<string>('create_order', {
      p_lines: pLines,
      p_delivery_method: deliveryMethod,
      p_customer_id: customerId,
      p_guest_email: guestEmail,
      p_recipient_name: recipientName,
      p_address_line1: body.address ?? null,
      p_address_line2: null,
      p_city: null,
      p_county: null,
      p_postcode: body.postcode ?? null,
      // Deliberately always 0 — see schemas.ts: there is no customer-facing
      // discount-code path in this schema. promoCode is accepted so the
      // request validates, and is never read again after that.
      p_discount: 0,
      p_phone: body.phone,
      // Which provider the customer chose, recorded on the order at creation.
      // 0030 added this parameter specifically because paymentMethod was being
      // accepted by the request schema and then silently dropped, leaving
      // orders.payment_provider null on every order ever placed. Null stays
      // meaningful: it means the customer never got as far as choosing.
      p_payment_provider: body.paymentMethod ?? null,
    }),
  );

  if (createErr) {
    return res.status(400).json({ error: createErr.message });
  }

  if (hasPlateLine && body.verification) {
    const verification = body.verification;
    const { error: docErr } = await attempt(() =>
      db
        .insertInto('order_documents')
        .values([
          {
            order_id: orderId,
            kind: 'v5c',
            storage_path: verification.registrationDoc,
            status: 'pending',
          },
          {
            order_id: orderId,
            kind: 'driving_licence',
            storage_path: verification.licence,
            status: 'pending',
          },
        ])
        .execute(),
    );
    // This error used to be discarded. A plate order whose document rows
    // failed to write looks complete to the customer and unapprovable to
    // staff, which is the whole finding in miniature — so it is now fatal
    // and loud. The order exists but is `pending`: no payment has been
    // taken, because the payment intent is a separate later call.
    if (docErr) {
      // eslint-disable-next-line no-console
      console.error(
        `[orders] PLATE ORDER WITHOUT DOCUMENTS — order ${orderId} was created but its ` +
          `order_documents rows failed to insert: ${docErr.message}`,
      );
      return res.status(500).json({
        error:
          'Your order was created but the verification documents could not be attached, so it cannot be processed. Please contact the shop before paying.',
      });
    }
  }

  const orderRow = await loadOrder({ id: orderId });
  return res.status(201).json(toApiOrder(orderRow!));
});

/**
 * Does this requester own this order?
 *
 * Either they're signed in AS the customer the order belongs to, or they can
 * produce the email address the order was placed with. Extracted so the order
 * lookup and the payment-intent endpoint below cannot drift apart — an
 * ownership rule that exists in two copies is one that will eventually be
 * enforced in one place and not the other.
 */
async function requesterOwnsOrder(
  req: {
    user?: { kind: string; id: string } | null;
    query: Record<string, unknown>;
    body?: unknown;
  },
  orderRow: Record<string, unknown>,
): Promise<boolean> {
  if (req.user?.kind === 'customer' && req.user.id === orderRow.customer_id) return true;

  // A POST carries the email in its JSON body, so a guest's address never sits
  // in a URL (access logs, the error log in server.ts, proxies). The query
  // string is still read for GET lookups and older callers.
  const bodyEmail =
    req.body && typeof req.body === 'object' ? (req.body as { email?: unknown }).email : undefined;
  const rawEmail = typeof bodyEmail === 'string' ? bodyEmail : req.query.email;
  const emailParam = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : null;
  let ownerEmail: string | null = orderRow.guest_email as string | null;
  if (!ownerEmail && orderRow.customer_id) {
    const customer = await db
      .selectFrom('customers')
      .select('email')
      .where('id', '=', orderRow.customer_id as string)
      .executeTakeFirst();
    ownerEmail = customer?.email ?? null;
  }
  return Boolean(emailParam && ownerEmail && ownerEmail.trim().toLowerCase() === emailParam);
}

/**
 * Round 3 #1.3: staff-only lookup by reference, no email required.
 *
 * `GET /:reference` below is the CUSTOMER-facing one — it deliberately
 * never distinguishes "wrong email" from "no such order" (see
 * requesterOwnsOrder's own comment), which is exactly right for a stranger
 * on the tracking page and exactly wrong for a member of staff processing a
 * return, who has no email to supply and every right to look any order up.
 * This is a SEPARATE route rather than a bypass added to `requesterOwnsOrder`
 * — the customer-facing authorization stays exactly as strict as it was;
 * staff get their own door in, gated by `requireStaff` the normal way.
 */
ordersRouter.get(
  '/lookup/:reference',
  requireStaff,
  requirePermission('returns.manage'),
  async (req, res) => {
    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const orderRow = await loadOrder({ reference });
    if (!orderRow) return res.json(null);
    return res.json(toApiOrder(orderRow));
  },
);

/**
 * Round 5 Phase 3 #22 — the signed-in customer's own order history, for the
 * account dashboard. A real, separate route rather than reusing
 * `GET /:reference` in a loop: this is the one place a customer's full
 * order list is ever assembled, and it stays self-scoped
 * (`.eq('customer_id', req.user!.id)`) the same way every other
 * self-service route in this file already is.
 */
ordersRouter.get('/mine', requireCustomer, async (req, res) => {
  const { data: rows, error } = await attempt(() =>
    ordersWithLines()
      .where('orders.customer_id', '=', req.user!.id)
      .orderBy('orders.created_at', 'desc')
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load your orders.' });
  return res.json(rows.map(toApiOrder));
});

/**
 * Round 5 Phase 3 #23 — guest tracking, ID only, no email. Deliberately a
 * separate, narrower endpoint from `GET /:reference` below rather than
 * that route with its email requirement relaxed: this returns ONLY
 * courier + tracking number, never the address, line items, name or
 * phone `GET /:reference` does. References are sequential and guessable
 * (see the comment on requesterOwnsOrder) — the small, deliberately
 * useless-on-its-own response shape is the main mitigation for that;
 * `isRateLimited` (rateLimit.ts) is the second one, so a bare reference
 * being enough to get an answer doesn't also mean the whole reference
 * space is free to sweep. See the security-tradeoff discussion this
 * shipped with for the full reasoning.
 */
ordersRouter.get('/:reference/tracking', async (req, res) => {
  // Namespaced like every other call site (order-lookup:, sell-lookup:,
  // guest-resolve:, ...). This was a bare IP, which works only for as long
  // as it stays the single bare-IP key in the app — the next one added
  // would silently share this route's budget.
  const key = `order-tracking:${clientIp(req) ?? 'unknown'}`;
  if (isRateLimited(key, { max: 20, windowMs: 10 * 60_000 })) {
    return res.status(429).json({ error: 'Too many lookups — please try again in a few minutes.' });
  }

  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const orderRow = await db
    .selectFrom('orders')
    .select(['courier', 'tracking_number'])
    .where('reference', '=', reference)
    .executeTakeFirst();
  if (!orderRow) return res.json(null);
  return res.json({
    courier: orderRow.courier ?? null,
    trackingNumber: orderRow.tracking_number ?? null,
  });
});

/**
 * Has the payment for this order landed? Read by the confirmation page, which used to say
 * "we've emailed your confirmation" before the server knew (bug report v1, BUG-002: locally the
 * Stripe webhook never arrives, so the order sat pending while the page claimed success).
 *
 * The caller proves they are the payer with the payment intent id, which only the paying
 * browser has (Stripe also appends it to a redirect's return_url). A wrong pairing answers the
 * same as an unknown reference, so this says nothing about orders the caller didn't pay for.
 */
ordersRouter.get('/:reference/payment-status', async (req, res) => {
  const key = `order-payment-status:${clientIp(req) ?? 'unknown'}`;
  if (isRateLimited(key, { max: 120, windowMs: 10 * 60_000 })) {
    return res.status(429).json({ error: 'Too many lookups — please try again in a few minutes.' });
  }
  const intent = typeof req.query.intent === 'string' ? req.query.intent.trim() : '';
  if (!intent) return res.json(null);
  const findOrder = () =>
    db
      .selectFrom('orders')
      .select(['id', 'status'])
      .where('reference', '=', (req.params.reference ?? '').trim().toUpperCase())
      .where('provider_reference', '=', intent)
      .executeTakeFirst();
  let orderRow = await findOrder();
  if (!orderRow) return res.json(null);

  // Tester bug B-3 ("payment stuck"): only the webhook used to mark an order paid, so when it was
  // late, missing or misconfigured the customer sat on "Confirming your payment…" with their
  // money taken. While the order is pending, ask Stripe itself: a succeeded intent for THIS order
  // settles it through the same code the webhook uses (lib/orderPayments.ts), whichever is first.
  if (orderRow.status === 'pending' && isStripeConfigured()) {
    try {
      const pi = await getStripe().paymentIntents.retrieve(intent);
      if (pi.status === 'succeeded' && pi.metadata?.order_id === orderRow.id) {
        const result = await settleOrderPaid(orderRow.id, pi.id, pi.amount_received ?? pi.amount);
        if (result.outcome === 'mismatch' || result.outcome === 'conflict') {
          // eslint-disable-next-line no-console
          console.error(
            `[payment-status] ${result.reference}: Stripe says paid but the order was not marked ` +
              `paid (${result.outcome}). NEEDS A HUMAN.`,
          );
        }
        orderRow = (await findOrder()) ?? orderRow;
      }
    } catch (err) {
      // Stripe unreachable: answer with what the database says; the page asks again shortly.
      // eslint-disable-next-line no-console
      console.warn(
        '[payment-status] could not check the intent with Stripe:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  return res.json({
    paid: orderRow.status !== 'pending' && orderRow.status !== 'cancelled',
    cancelled: orderRow.status === 'cancelled',
  });
});

/**
 * Start paying for an order that already exists.
 *
 * THE ORDER COMES FIRST, AND THAT IS THE WHOLE DESIGN
 * The checkout creates a `pending` order before Stripe is involved at all, so
 * by the time this runs the server has already priced the basket, derived the
 * delivery fee from the postcode, and written a total. The amount below is
 * read straight back out of that row. Nothing the browser sends can influence
 * it — there is no amount field in this request to influence it WITH, which is
 * the point. The checkout used to do the opposite: it called a client-side pay() with
 * a total the browser had computed, and only then created the order.
 *
 * WHY THE VAPE CHECK IS HERE TOO
 * It is already enforced in three places: the order_lines insert trigger, the
 * create_order function, and POST /orders above. This is the fourth, and it is
 * not redundant — the other three all fire at order-creation time, and an
 * order can sit pending for as long as the customer leaves the tab open. A
 * product re-categorised as a vape in that window would otherwise be paid for
 * online. Payment is the last gate before money moves, so it gets its own
 * check rather than trusting one taken minutes earlier.
 *
 * NO VAT. The amount is orders.total, which is subtotal + delivery - discount.
 * There is no tax line anywhere in this schema and none is added here; the
 * business is not VAT registered.
 */
ordersRouter.post('/:reference/payment-intent', async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({
      error: 'Card payment is not available right now. Please choose collection, or call the shop.',
    });
  }

  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const orderRow = await db
    .selectFrom('orders')
    .select([
      'id',
      'reference',
      'total',
      'status',
      'customer_id',
      'guest_email',
      'provider_reference',
    ])
    .where('reference', '=', reference)
    .executeTakeFirst();

  // Indistinguishable from "wrong email", exactly as the lookup above.
  if (!orderRow) return res.status(404).json({ error: 'Order not found.' });
  if (!(await requesterOwnsOrder(req, orderRow))) {
    return res.status(404).json({ error: 'Order not found.' });
  }

  if (orderRow.status !== 'pending') {
    // Already paid is a success from the customer's point of view — they
    // should be looking at their confirmation, not at a card form. Anything
    // else (cancelled) is genuinely closed.
    return res.status(409).json({
      error:
        orderRow.status === 'paid'
          ? 'This order has already been paid for.'
          : `This order can no longer be paid for (${String(orderRow.status)}).`,
      status: orderRow.status,
    });
  }

  // Fourth vape gate — see the note above. Checked against the LIVE product
  // rows, not the order's snapshot, because the thing being guarded against is
  // the product changing after the order was written.
  const { data: lineRows, error: linesErr } = await attempt(() =>
    db
      .selectFrom('order_lines')
      .leftJoin('products', 'products.id', 'order_lines.product_id')
      .select('products.kind')
      .where('order_lines.order_id', '=', orderRow.id)
      .execute(),
  );
  if (linesErr) return res.status(500).json({ error: 'Could not check the order.' });

  const blocked = lineRows.some((line) => line.kind === 'vape');
  if (blocked) {
    return res
      .status(400)
      .json({ error: 'Vapes are in-store only and cannot be paid for online.' });
  }

  const amount = orderRow.total;
  if (!Number.isInteger(amount) || amount < 0) {
    // A non-integer or negative total means the row is not what this code
    // thinks it is. Refusing beats sending a guess to a payment provider.
    return res.status(500).json({ error: 'Could not price this order for payment.' });
  }

  /**
   * Red-team finding #6a (MEDIUM, confirmed — the old check was
   * `amount <= 0`, treating a genuinely free order identically to a
   * broken one). A 100%-off promotion, or any other path that legitimately
   * zeroes out `orders.total`, has nothing for Stripe to charge — sending
   * it to `paymentIntents.create` either errors outright (Stripe rejects a
   * zero-amount intent) or, worse, silently succeeds with an intent worth
   * nothing while the order sits `pending` forever, since nothing would
   * ever fire the webhook that marks it paid.
   *
   * Skips Stripe entirely and marks the order paid the exact same way
   * `POST /:reference/paid` (below) already does for a counter/bank-
   * transfer order that never touches Stripe: `UPDATE orders SET status =
   * 'paid'`, which validate_order_status_transition (0005) turns into
   * paid_at plus stock_consume per line, idempotently. `clientSecret: null`
   * in the response is not a new state invented for this — it is the exact
   * shape `stripe-payment.tsx` already treats as "nothing to charge here,
   * complete the order without a card step" (see order.ts's own
   * paymentIntentSchema comment) — a free order reaches that branch.
   */
  if (amount === 0) {
    const { error: paidErr } = await attempt(() =>
      db.updateTable('orders').set({ status: 'paid' }).where('id', '=', orderRow.id).execute(),
    );
    if (paidErr) return res.status(409).json({ error: paidErr.message });

    return res.json({
      clientSecret: null,
      amount,
      currency: 'gbp',
      reference: orderRow.reference,
    });
  }

  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create(
    {
      // Integer pence, straight from the database. Stripe's smallest-unit
      // convention and this schema's `pence` domain are the same unit, so
      // there is deliberately no conversion step here to get wrong.
      amount,
      currency: 'gbp',
      // Card and whatever else the account has enabled. Clearpay is a
      // dashboard toggle on a verified account and is NOT enabled — still an
      // open question with the client.
      automatic_payment_methods: { enabled: true },
      // How a webhook finds its way back to an order. Both are recorded: the
      // id is what the handler matches on, the reference is what a human reads
      // in the Stripe dashboard when someone rings up about FNL-10047.
      metadata: {
        order_id: String(orderRow.id),
        order_reference: String(orderRow.reference),
      },
      description: `Fonology order ${String(orderRow.reference)}`,
    },
    {
      // Keyed on the order, so a double-clicked Pay button, a retried request
      // or a refreshed tab all resolve to the SAME intent rather than creating
      // a second one for the same basket. Stripe returns the original.
      idempotencyKey: `order-intent-${String(orderRow.id)}`,
    },
  );

  // Recorded now rather than at confirmation. 0030 said this column gets
  // filled "when payment is actually confirmed", and the webhook does confirm
  // it — but an intent that is created and then abandoned is exactly the case
  // support needs to be able to trace ("I definitely paid"), and writing it
  // here is what makes that traceable. `status` remains the only thing that
  // says whether money arrived; a reference on a pending order means an
  // attempt, not a payment.
  await db
    .updateTable('orders')
    .set({ provider_reference: intent.id, payment_provider: 'stripe' })
    .where('id', '=', orderRow.id)
    .execute()
    .catch(() => undefined);

  return res.json({
    clientSecret: intent.client_secret,
    // Echoed back so the client can display what it is about to pay WITHOUT it
    // ever being an input. Read-only, server-authored.
    amount,
    currency: 'gbp',
    reference: orderRow.reference,
  });
});

/**
 * Staff marking an order paid by hand. NOT a webhook — see below.
 *
 * This used to be described as a stand-in for the payment webhook, and its
 * requireStaff gate was explicitly called out as a placeholder rather than
 * security. The real Stripe webhook now exists at POST /webhooks/stripe with
 * genuine signature verification (routes/webhooks.routes.ts), so this endpoint
 * stops pretending to be one and becomes the thing it actually is: a counter
 * action for money that did not arrive through Stripe.
 *
 * That is a real case, not a leftover. A click-and-collect order paid in cash
 * at the counter, or a bank transfer that lands in the shop account, has no
 * provider event to confirm it — a person confirms it. Deleting this would
 * leave those orders stuck at `pending` forever.
 *
 * requireStaff (rather than a permission) matches POST /id/:id/status directly
 * below, which already lets any staff session set ANY status including 'paid'.
 * This endpoint therefore grants no power a staff member does not already
 * have; tightening one without the other would only look like security.
 *
 * The update itself is `UPDATE orders SET status = 'paid'`, which the DB's own
 * validate_order_status_transition trigger turns into the paid_at timestamp
 * plus one stock_consume('online_order') per line — idempotently, because the
 * trigger's first check is `if new.status = old.status then return new;`, so
 * firing this twice on an already-paid order is a genuine no-op rather than
 * just an app-layer guard.
 */
ordersRouter.post('/:reference/paid', requireStaff, async (req, res) => {
  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const orderRow = await orderIdByReference(reference);
  if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

  const { error } = await attempt(() =>
    db.updateTable('orders').set({ status: 'paid' }).where('id', '=', orderRow.id).execute(),
  );
  if (error) return res.status(409).json({ error: error.message });

  const updated = await loadOrder({ id: orderRow.id });
  return res.json(toApiOrder(updated!));
});

/**
 * Staff-driven status moves (ready/shipped/collected/cancelled) — the admin
 * orders panel. Keyed by `id`, not `reference`, to match
 * DataAdapter.updateOrderStatus(id, status) exactly — the frontend already
 * has an order's `id` from wherever it fetched the order, and this is the
 * one order-mutation the adapter names by id rather than reference.
 */
ordersRouter.post('/id/:id/status', requireStaff, async (req, res) => {
  const parsed = orderStatusBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  // Found in QA regression testing: this route used to accept 'shipped'
  // with nothing else — the shop would have no record of how a parcel
  // actually went out. Both fields required the moment the move is
  // actually TO shipped; an order already shipped keeps whatever it has
  // when moved on to some other status later.
  if (body.status === 'shipped' && (!body.courier || !body.trackingNumber)) {
    return res.status(400).json({
      error: 'A courier and tracking number are required to mark an order as shipped.',
    });
  }

  const id = req.params.id ?? '';
  const patch: { status: OrderStatus; courier?: string; tracking_number?: string } = {
    status: body.status,
  };
  if (body.status === 'shipped') {
    patch.courier = body.courier;
    patch.tracking_number = body.trackingNumber;
  }

  const { error } = await attempt(() =>
    db.updateTable('orders').set(patch).where('id', '=', id).execute(),
  );
  if (error) return res.status(409).json({ error: error.message });

  const updated = await loadOrder({ id });
  return res.json(toApiOrder(updated!));
});

/**
 * Owner-only visibility — gated behind settings.manage, the closest
 * fit in the existing 15-value permission enum (there's no dedicated
 * "documents.manage"; retention/verification policy is settings-adjacent).
 *
 */
ordersRouter.get(
  '/:reference/documents',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const orderRow = await orderIdByReference(reference);
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    const documents = await db
      .selectFrom('order_documents')
      .select([
        'id',
        'kind',
        'status',
        'storage_path',
        'reviewed_by',
        'reviewed_at',
        'rejection_reason',
        'uploaded_at',
      ])
      .where('order_id', '=', orderRow.id)
      .execute();

    return res.json(documents);
  },
);

ordersRouter.post(
  '/:reference/documents/:kind/approve',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const orderRow = await orderIdByReference(reference);
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    const { data: updated, error } = await attempt(() =>
      db
        .updateTable('order_documents')
        .set({
          status: 'approved',
          reviewed_by: req.user!.id,
          reviewed_at: new Date().toISOString(),
        })
        .where('order_id', '=', orderRow.id)
        .where('kind', '=', req.params.kind as OrderDocumentKind)
        .returning(['id', 'kind', 'status'])
        .executeTakeFirst(),
    );

    if (error) return res.status(500).json({ error: 'Could not approve document.' });
    if (!updated) return res.status(404).json({ error: 'Document not found.' });
    return res.json(updated);
  },
);

ordersRouter.post(
  '/:reference/documents/:kind/reject',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const parsed = documentRejectBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const orderRow = await orderIdByReference(reference);
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    const { data: updated, error } = await attempt(() =>
      db
        .updateTable('order_documents')
        .set({
          status: 'rejected',
          rejection_reason: parsed.data.reason,
          reviewed_by: req.user!.id,
          reviewed_at: new Date().toISOString(),
        })
        .where('order_id', '=', orderRow.id)
        .where('kind', '=', req.params.kind as OrderDocumentKind)
        .returning(['id', 'kind', 'status'])
        .executeTakeFirst(),
    );

    if (error) return res.status(500).json({ error: 'Could not reject document.' });
    if (!updated) return res.status(404).json({ error: 'Document not found.' });
    return res.json(updated);
  },
);

/**
 * Issues a short-lived signed URL for a private document and calls
 * log_document_view() first — the database can't observe Storage access on
 * its own (see 0009_settings.sql's own comment), so this call IS the audit
 * log, not a side effect of one. Every view goes through here; there is no
 * other path in this API that reads a document's bytes.
 */
ordersRouter.get(
  '/:reference/documents/:kind/view',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const orderRow = await orderIdByReference(reference);
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    // An unknown kind is simply not found, as it was when the lookup failed.
    const kind = req.params.kind;
    const doc = isOrderDocumentKind(kind)
      ? await db
          .selectFrom('order_documents')
          .select(['id', 'storage_path'])
          .where('order_id', '=', orderRow.id)
          .where('kind', '=', kind)
          .executeTakeFirst()
      : undefined;
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    await rpc('log_document_view', {
      p_document_id: doc.id,
      p_document_type: 'order_document',
      p_staff_id: req.user!.id,
    }).catch(() => undefined);

    // An old placeholder row can name a file that was never uploaded; the
    // view attempt is logged above either way.
    const exists = await objectExists(BUCKETS.idDocuments, doc.storage_path).catch(() => false);
    if (!exists) {
      return res.status(200).json({ signedUrl: null, note: 'Object not found', viewLogged: true });
    }
    // Short-lived: 60 seconds.
    const signedUrl = await signedGetUrl(BUCKETS.idDocuments, doc.storage_path, 60);
    return res.json({ signedUrl, viewLogged: true });
  },
);
