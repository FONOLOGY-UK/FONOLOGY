import type { SelectQueryBuilder } from 'kysely';
import type { BookingStatus, DB } from '../db/types.js';
import { attempt, db, rpc } from '../lib/db.js';
import { clientIp } from '../lib/clientIp.js';
import { isRateLimited, limitByIp } from '../lib/rateLimit.js';
import {
  requireStaff,
  requireCustomer,
  requirePermission,
  blockStaffCheckout,
} from '../middleware/auth.js';
import { bookingConvertBodySchema, bookingInputBodySchema } from '../schemas.js';

import { cachePublicGets } from '../middleware/cache.js';
import { createRouter } from '../lib/router.js';
import { notifyJobStageLater } from '../lib/jobSms.js';
import { hubShopId, readShop } from '../lib/shopScope.js';
import { optionalPaging, pageWithTotals, UNPAGED_LIST_CAP } from '../lib/pagination.js';
import { offeredPrice, offersForDevice } from '../lib/repairPricing.js';
import { isUuid } from '../lib/uuid.js';

export const repairsRouter = createRouter();

/* ---------------------------------------------------------------------- */
/* Catalogue reads — devices, repair types, part tiers, quote               */
/* ---------------------------------------------------------------------- */

repairsRouter.get('/devices', cachePublicGets(0), async (_req, res) => {
  const { data, error } = await attempt(() =>
    db
      .selectFrom('devices')
      .select(['id', 'name', 'brand'])
      .where('is_active', '=', true)
      .orderBy('name')
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load devices.' });
  return res.json(data.map((d) => ({ id: d.id, name: d.name, brand: d.brand })));
});

/** Repair types — definitions only since 0109: prices live on the device. */
repairsRouter.get('/types', cachePublicGets(0), async (_req, res) => {
  const { data, error } = await attempt(() =>
    db
      .selectFrom('repair_types')
      .select(['id', 'name', 'description', 'estimate_label', 'diagnosis_only'])
      .where('is_active', '=', true)
      .orderBy('name')
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load repair types.' });
  return res.json(
    data.map((r) => ({
      id: r.id,
      name: r.name,
      desc: r.description ?? '',
      time: r.estimate_label ?? '',
      diagnosisOnly: r.diagnosis_only,
    })),
  );
});

/** The grades a repair comes in (Original, OEM, Copy, custom ones) — deleted ones left out. */
repairsRouter.get('/sub-types', cachePublicGets(0), async (_req, res) => {
  const { data, error } = await attempt(() =>
    db
      .selectFrom('repair_sub_types')
      .select(['id', 'name', 'strap_line', 'warranty_label'])
      .where('removed_at', 'is', null)
      .orderBy('sort_order')
      .orderBy('name')
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load repair options.' });
  return res.json(
    data.map((t) => ({
      id: t.id,
      name: t.name,
      strap: t.strap_line ?? '',
      warranty: t.warranty_label,
    })),
  );
});

/**
 * What one device can be repaired for, and at what price (0109). Only what has a price on that
 * device — a repair or sub-type left blank is not offered and is not listed. Public: it is the
 * shop's price list, the same figures the website shows anyway.
 */
repairsRouter.get('/offers', async (req, res) => {
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : '';
  if (!isUuid(deviceId)) return res.status(400).json({ error: 'deviceId is required.' });
  const { data, error } = await attempt(() => offersForDevice(deviceId));
  if (error) return res.status(500).json({ error: 'Could not load prices for that device.' });
  return res.json(data);
});

/* ---------------------------------------------------------------------- */
/* Mail-in booking                                                          */
/* ---------------------------------------------------------------------- */

repairsRouter.post(
  '/bookings',
  limitByIp('booking-create', { max: 20, windowMs: 10 * 60_000 }),
  blockStaffCheckout('book a repair'),
  async (req, res) => {
    const parsed = bookingInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    // Price is computed server-side, from the schema's own function — never
    // trusted from the client, exactly like the quote read above.
    // Priced on the server from the device's own price list (0109). A choice with no price on
    // that device is not offered, so it cannot be booked.
    if (!isUuid(body.deviceId) || !isUuid(body.repairId)) {
      return res.status(400).json({ error: 'Choose your device and the repair.' });
    }
    const quotedPrice = await offeredPrice(body.deviceId, body.repairId, body.subTypeId ?? null);
    if (quotedPrice === null) {
      return res.status(400).json({
        error: 'That repair isn’t offered for this device. Please choose another option.',
      });
    }
    const subType = body.subTypeId
      ? await db
          .selectFrom('repair_sub_types')
          .select('legacy_tier')
          .where('id', '=', body.subTypeId)
          .executeTakeFirst()
      : undefined;

    // Round 5 Phase 3 #22 — attributed to the signed-in customer's account
    // when there is one, exactly like orders.routes.ts's create-order path;
    // null (a guest booking) otherwise. Never required — mail-in repair
    // booking has never needed an account (BUSINESS RULE) and still doesn't.
    const customerId = req.user?.kind === 'customer' ? req.user.id : null;

    const bookingShop = await hubShopId();
    const { data: row, error } = await attempt(() =>
      db
        .insertInto('bookings')
        .values({
          // Online repair bookings and mail-in parcels are all handled by the hub shop.
          shop_id: bookingShop,
          device_id: body.deviceId,
          repair_type_id: body.repairId,
          sub_type_id: body.subTypeId ?? null,
          tier: subType?.legacy_tier ?? null,
          quoted_price: quotedPrice,
          customer_id: customerId,
          customer_name: body.name,
          phone: body.phone,
          email: body.email,
          address_line1: body.address,
          postcode: body.postcode,
          preferred_contact: body.preferredContact,
          notes: body.notes ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json((await toApiBookings([row]))[0]);
  },
);

/**
 * The sub-type names a list of requests needs — deleted ones included (0109): a request keeps
 * saying "OEM" even after OEM is deleted from the shop's list.
 */
async function toApiBookings(rows: Record<string, unknown>[]) {
  const ids = [
    ...new Set(rows.map((r) => r.sub_type_id as string | null).filter(Boolean)),
  ] as string[];
  const names = ids.length
    ? new Map(
        (
          await db
            .selectFrom('repair_sub_types')
            .select(['id', 'name'])
            .where('id', 'in', ids)
            .execute()
        ).map((n) => [n.id, n.name]),
      )
    : new Map<string, string>();
  return rows.map((r) => toApiBooking(r, names));
}

function toApiBooking(row: Record<string, unknown>, names: Map<string, string> = new Map()) {
  return {
    id: row.id,
    reference: row.reference,
    deviceId: row.device_id,
    repairId: row.repair_type_id,
    subTypeId: row.sub_type_id ?? null,
    subTypeName: row.sub_type_id ? (names.get(row.sub_type_id as string) ?? null) : null,
    name: row.customer_name,
    phone: row.phone,
    email: row.email,
    address: row.address_line1,
    postcode: row.postcode,
    preferredContact: row.preferred_contact,
    notes: row.notes,
    // hyphenated to match the frontend's bookingStatusSchema — the only
    // naming difference from booking_status; the five values are otherwise
    // identical, unlike jobs/sell-requests.
    status: (row.status as string).replace('_', '-'),
    price: row.quoted_price,
    createdAt: row.created_at,
  };
}

/** Admin: all bookings — same gating precedent as GET /orders (requireStaff only). */
repairsRouter.get('/bookings', requireStaff, async (req, res) => {
  const shopId = readShop(req);
  const paging = optionalPaging(req);
  // Paged requests may also narrow by `status` (comma-separated, hyphenated as the screen has
  // them) and `search` (reference, name, email, phone).
  const statuses = (typeof req.query.status === 'string' ? req.query.status : '')
    .split(',')
    .map((s) => s.trim().replace('-', '_'))
    .filter(Boolean) as BookingStatus[];
  const term =
    typeof req.query.search === 'string' ? req.query.search.replace(/[%_,]/g, '').trim() : '';
  const filtered = <O>(qb: SelectQueryBuilder<DB, 'bookings', O>) => {
    let q = qb;
    if (shopId) q = q.where('shop_id', '=', shopId);
    if (paging && statuses.length > 0) q = q.where('status', 'in', statuses);
    if (paging && term) {
      const like = `%${term}%`;
      q = q.where((eb) =>
        eb.or([
          eb('reference', 'ilike', like),
          eb('customer_name', 'ilike', like),
          eb('email', 'ilike', like),
          eb('phone', 'ilike', like),
        ]),
      );
    }
    return q;
  };
  const { data: rows, error } = await attempt(() =>
    filtered(db.selectFrom('bookings').selectAll())
      .orderBy('created_at', 'desc')
      .limit(paging ? paging.limit : UNPAGED_LIST_CAP)
      .offset(paging?.offset ?? 0)
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load bookings.' });
  if (!paging) return res.json(await toApiBookings(rows));

  const whole = await filtered(
    db.selectFrom('bookings').select((eb) => eb.fn.countAll<number>().as('count')),
  ).executeTakeFirstOrThrow();
  return res.json(
    pageWithTotals(await toApiBookings(rows), Number(whole.count), paging, {
      count: Number(whole.count),
    }),
  );
});

/**
 * Round 5 Phase 3 #22 — the signed-in customer's own repair booking
 * history, for the account dashboard. Self-scoped the same way
 * GET /orders/mine is; registered before /bookings/:reference so "mine"
 * is never swallowed as a reference lookup.
 */
repairsRouter.get('/bookings/mine', requireCustomer, async (req, res) => {
  const { data: rows, error } = await attempt(() =>
    db
      .selectFrom('bookings')
      .selectAll()
      .where('customer_id', '=', req.user!.id)
      .orderBy('created_at', 'desc')
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load your repair bookings.' });
  return res.json(await toApiBookings(rows));
});

/**
 * Guest read-back: reference + email.
 * Rate limited like the order tracking lookup:
 * references are sequential, so IP is what varies across a sweep.
 */
repairsRouter.get('/bookings/:reference', async (req, res) => {
  if (
    isRateLimited(`booking-lookup:${clientIp(req) ?? 'unknown'}`, {
      max: 10,
      windowMs: 10 * 60_000,
    })
  ) {
    return res.status(429).json({ error: 'Too many lookups — please try again in a few minutes.' });
  }
  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : null;

  const row = await db
    .selectFrom('bookings')
    .selectAll()
    .where('reference', '=', reference)
    .executeTakeFirst();
  if (!row || !email || row.email.trim().toLowerCase() !== email) {
    return res.json(null);
  }
  return res.json((await toApiBookings([row]))[0]);
});

/* ---------------------------------------------------------------------- */
/* "My model isn't listed" — an enquiry, not a fake device row              */
/* ---------------------------------------------------------------------- */

/**
 * Change request item 2 — which details each repair type needs collecting at
 * intake, for the "Send to Jobs" pop-up.
 *
 * DELIBERATELY NOT ON GET /repair/types, which is the PUBLIC endpoint the
 * storefront's repair wizard reads. Two reasons, and the first one bit
 * during verification: adding the column to that select made the whole
 * public endpoint 500 on a database without 0088, taking the customer-facing
 * booking flow down rather than just the new feature. The second is that a
 * customer has no business knowing what the shop collects at the bench.
 *
 * Returned as a map keyed by repair type id — one request for the whole
 * lookup, rather than one per row on a list of requests.
 */
repairsRouter.get(
  '/conversion-fields',
  requireStaff,
  requirePermission('jobs.manage'),
  async (_req, res) => {
    const { data, error } = await attempt(() =>
      db.selectFrom('repair_types').select(['id', 'conversion_required_fields']).execute(),
    );
    if (error) {
      return res.status(500).json({ error: 'Could not load the intake requirements.' });
    }
    const out: Record<string, string[]> = {};
    for (const row of data) {
      out[row.id] = row.conversion_required_fields ?? ['quote'];
    }
    return res.json(out);
  },
);

/**
 * Change request item 2 — turn a repair request into a bench job.
 *
 * Everything the customer already told us is carried across by
 * convert_booking_to_job(); this endpoint only supplies the details the
 * request could not contain, and only the ones that repair type is
 * configured to require. Staff re-keying a name and a phone number off a
 * screen the customer filled in was the whole complaint.
 *
 * One transaction in the function, deliberately: a job created against a
 * request still showing as unclaimed is how the same device gets booked onto
 * the bench twice.
 *
 * Numbering: the job gets the next JOB- number from its own sequence (0091)
 * and the request keeps its FNL- reference. (This comment once said the two
 * were already independent; they shared one sequence until 0091.) The job
 * number appears on the request through the existing jobs.booking_id link,
 * not a new column.
 */
repairsRouter.post(
  '/bookings/:id/convert',
  requireStaff,
  requirePermission('jobs.manage'),
  async (req, res) => {
    const parsed = bookingConvertBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { data: jobId, error } = await attempt(() =>
      rpc<string>('convert_booking_to_job', {
        p_booking_id: req.params.id,
        // From the session, never the body — same rule as every other staff
        // attribution here.
        p_staff_id: req.user!.id,
        p_quoted_price: parsed.data.quotedPrice ?? null,
        p_intake_details: parsed.data.intakeDetails ?? {},
      }),
    );
    // Every guard in the function raises with a sentence already written for
    // a person ("already on the bench", "a quote is required", "missing
    // required detail: passcode"), so there is nothing to reword.
    if (error) return res.status(409).json({ error: error.message });

    const job = await db
      .selectFrom('jobs')
      .select(['id', 'reference'])
      .where('id', '=', jobId)
      .executeTakeFirst();
    if (!job) return res.status(500).json({ error: 'Converted, but could not load the new job.' });
    // An online booking is texted once it is a job (0105): the customer's choice from this
    // screen, then the 'booked in' text for the stage the new job starts at.
    if (parsed.data.smsUpdates === false) {
      await db.updateTable('jobs').set({ sms_updates: false }).where('id', '=', job.id).execute();
    }
    notifyJobStageLater(job.id, req.user!.id);
    return res.status(201).json({ id: job.id, reference: job.reference });
  },
);
