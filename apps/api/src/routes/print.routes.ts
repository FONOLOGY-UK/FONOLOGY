import { attempt, db, rpc } from '../lib/db.js';
import type { PrintJobStatus, PrintJobs } from '../db/types.js';
import type { Selectable } from 'kysely';
import { isUuid } from '../lib/uuid.js';
import { staffNamesFor } from '../lib/staffNames.js';
import { createRouter } from '../lib/router.js';
import { requireStaff, requirePermission } from '../middleware/auth.js';
import { canRead, readShop, writeShop } from '../lib/shopScope.js';
import { requireAgent, generateAgentToken, hashAgentToken } from '../middleware/agentAuth.js';
import { buildPrintPayload, PrintPayloadError, resolveTarget } from '../lib/printPayloads.js';
import { evaluateAgentHealth, type OpeningHoursEntry } from '../lib/printHealth.js';
import { notifyPrintJob, waitForPrintJob } from '../lib/printNotify.js';
import {
  printEnqueueBodySchema,
  printClaimQuerySchema,
  printFailBodySchema,
  printResolveBodySchema,
  printHeartbeatBodySchema,
  printAgentCreateBodySchema,
} from '../schemas.js';

/**
 * Print queue endpoints (migration 0033).
 *
 * Two audiences, two credentials, no overlap:
 *   - STAFF (session cookie) enqueue jobs, watch the queue, and answer the
 *     `unconfirmed` question.
 *   - The AGENT (bearer token) leases work, acknowledges it, and heartbeats.
 *     Nothing else in this API is reachable with that token.
 *
 * THE STATE MACHINE, in one place, because it is the whole design:
 *
 *   queued ──lease──> leased ──ack──> printed
 *                       │
 *                       ├─ fail(reachedPrinter: false) ─> queued (attempts left)
 *                       │                              └─> failed  (exhausted)
 *                       │
 *                       ├─ fail(reachedPrinter: true) ──> receipt: unconfirmed
 *                       │                                 label:   queued/failed
 *                       │
 *                       └─ lease expiry (silence) ──────> receipt: unconfirmed
 *                                                         label:   queued/failed
 *
 *   unconfirmed ──staff says "it printed"── > printed
 *   unconfirmed ──staff says "reprint"────── > queued
 *   failed ──staff retries──────────────────> queued
 *
 * The receipt/label asymmetry is not fussiness. A duplicate receipt in a
 * customer's hand is what a fraudulent return looks like; a duplicate label is
 * an inch of wasted roll.
 */

export const printRouter = createRouter();

const DEFAULT_LEASE_SECONDS = 60;
const LONG_POLL_SECONDS = 25;

/**
 * How long a parked poll waits before re-checking the database on its own.
 *
 * Deliberately slow. The in-process notifier (lib/printNotify.ts) is what
 * makes enqueue→print fast; this timer only exists to catch the cases the
 * notifier cannot see — a second API instance, a label requeued by the lease
 * sweep, a staff "reprint" handled by another process. Making it fast again
 * would restore the per-tick database round trip this design removed.
 *
 * 5s is the balance: two parked loops cost ~24 queries a minute while the shop
 * is idle (trivial), and if the notifier ever fails to reach a poll, nothing
 * waits longer than five seconds. Measured against the dev project one claim
 * costs ~0.6–1.0s of round trip, which is why this is seconds and not
 * milliseconds.
 */
const SAFETY_POLL_MS = 5000;

/* ==========================================================================
 * STAFF — enqueue
 * ======================================================================== */

/**
 * What each kind of print requires, matching how the SCREEN it is printed
 * from is already gated.
 *
 * This started as a single `pos.operate` on the whole endpoint, which was
 * wrong in a way that only shows up on a real rota: a stock-room member of
 * staff holds `inventory.manage` and no till permission, so they could open
 * inventory, pick a product, and then be refused permission to print its
 * shelf label.
 *
 * `shelf_label` deliberately maps to `inventory.manage`, NOT `labels.manage`:
 * the label designer page (`labels.manage`) is for BUILDING templates, which
 * is an owner-ish activity. Actually printing a shelf label happens from
 * inventory, by whoever is pricing up stock.
 *
 * `refund_receipt` maps to `returns.manage` and NOT `pos.operate`, by the same
 * rule. It was `pos.operate` until a permission probe showed what that meant
 * in practice: an employee holding the till permission but not the returns one
 * could enqueue a receipt for a refund they cannot create (POST /pos/refunds),
 * cannot list (GET /pos/refunds), and whose screen they cannot open — all
 * three of which require `returns.manage`. The button was correctly hidden and
 * the endpoint accepted the call anyway, which is the failure mode where a UI
 * gate gets mistaken for a real one.
 */
const PERMISSION_FOR_KIND = {
  sale_receipt: 'pos.operate',
  refund_receipt: 'returns.manage',
  payout_receipt: 'tradein.manage',
  job_label: 'jobs.manage',
  shelf_label: 'inventory.manage',
  // Item 7. 'sales.today' is what already gates GET /pos/today/report — the
  // same figures this prints. Gating the paper more tightly than the screen
  // it copies would mean staff who can read the day cannot print it, which
  // is the "the button is hidden so the endpoint must be safe" confusion
  // the refund_receipt note below is about, run in reverse.
  day_report: 'sales.today',
  // Test prints reconfigure/diagnose hardware — an owner activity, and the
  // only kind that produces paper nobody asked for.
  test_print: 'settings.manage',
} as const;

/**
 * Enqueue a print job.
 *
 * `requested_by` comes from the session and is never read from the body — same
 * rule as every money and stock record in this schema. The payload is built
 * here, server-side, from the entity id.
 *
 * A repeated dedupeKey is a SUCCESS, not an error: the till pressing Print
 * twice must be a no-op, not a scary red message. It returns the existing job.
 *
 * Permission is checked INSIDE the handler rather than as middleware because
 * it depends on the body — see PERMISSION_FOR_KIND.
 */
printRouter.post('/jobs', requireStaff, async (req, res) => {
  const parsed = printEnqueueBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'kind and dedupeKey are required.' });
  }
  const { kind, entityId, variant, dedupeKey } = parsed.data;

  // Not TARGET_FOR_KIND directly: a test print can exercise either printer,
  // which is the whole point of it. Every other kind is still a fixed lookup.
  const target = resolveTarget(kind, variant);

  const needed = PERMISSION_FOR_KIND[kind];
  if (!req.user?.permissions?.includes(needed)) {
    return res.status(403).json({ error: `Missing permission: ${needed}` });
  }

  // The job prints where the person is standing: their shop's printers, whichever shop the
  // sale or product it is about came from (a cross-shop refund receipt prints at the shop
  // that paid out).
  const shopId = await writeShop(req, res);
  if (!shopId) return;

  const byDedupeKey = () =>
    db
      .selectFrom('print_jobs')
      .select(['id', 'status'])
      .where('dedupe_key', '=', dedupeKey)
      .executeTakeFirst();
  const existing = await byDedupeKey();
  if (existing) {
    return res.status(200).json({ id: existing.id, status: existing.status, duplicate: true });
  }

  let payload;
  try {
    // Item 7: a day report has no entity — the day is whatever shop_day()
    // says now. The id it takes is the STAFF member whose name goes on the
    // paper, and that comes from the session, never the body, like every
    // other attribution here. Anything a caller put in entityId is ignored.
    payload = await buildPrintPayload(
      kind,
      kind === 'day_report' ? req.user.id : entityId,
      variant,
      shopId,
    );
  } catch (err) {
    if (err instanceof PrintPayloadError) return res.status(400).json({ error: err.message });
    throw err;
  }

  const requestedBy = req.user.id;
  const { data, error } = await attempt(() =>
    db
      .insertInto('print_jobs')
      .values({
        kind,
        target,
        payload: JSON.stringify(payload),
        dedupe_key: dedupeKey,
        requested_by: requestedBy,
        shop_id: shopId,
      })
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow(),
  );

  // Lost a race against a concurrent enqueue of the same key — still a no-op.
  if (error?.code === '23505') {
    const again = await byDedupeKey();
    return res.status(200).json({ id: again?.id, status: again?.status, duplicate: true });
  }
  if (error) throw new Error(error.message);

  // Wake any agent already parked on a long-poll. This is the whole reason
  // enqueue→paper is fast rather than "within the next tick".
  notifyPrintJob(target);

  res.status(201).json({ id: data.id, status: data.status, duplicate: false });
});

/* ==========================================================================
 * AGENT — lease, acknowledge, heartbeat
 * ======================================================================== */

/**
 * Long-poll for the next job.
 *
 * WHY LONG-POLL AND NOT A 2-SECOND TIMER
 * Staff press Print with a customer standing there. A 2s poll averages 1s of
 * dead time before the printer even hears about it, and that is exactly the
 * kind of lag that makes staff stop trusting a till. Holding the request open
 * means the job goes out within one database round-trip of being enqueued —
 * and it costs FEWER requests than short polling, not more.
 *
 * `waitSeconds=0` degrades to a plain short poll, which is the agent's
 * automatic fallback if anything between the shop and Germany (a proxy, a
 * captive-portal router) breaks long-lived requests.
 *
 * Aborts the moment the client disconnects, so a dropped agent doesn't leave
 * a handler spinning on the server for 25 seconds.
 */
printRouter.get('/jobs/next', requireAgent, async (req, res) => {
  const parsed = printClaimQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid claim parameters.' });
  const { target, leaseSeconds, waitSeconds } = parsed.data;

  const lease = leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const budgetMs = (waitSeconds ?? LONG_POLL_SECONDS) * 1000;
  const deadline = Date.now() + budgetMs;

  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  for (;;) {
    const { data, error } = await attempt(() =>
      rpc<Selectable<PrintJobs>[]>(
        'claim_print_job',
        { p_agent_id: req.agent!.id, p_lease_seconds: lease, p_target: target ?? null },
        { returnsSet: true },
      ),
    );

    if (error) {
      // Raised by the function when this agent is not the primary. A second
      // install must be told plainly rather than left looking idle.
      if (error.code === 'P0001') {
        return res.status(409).json({
          error:
            'This agent is not the primary print agent. Another agent is already handling the queue.',
        });
      }
      throw new Error(error.message);
    }

    const job = data[0];
    if (job) {
      return res.json({
        id: job.id,
        kind: job.kind,
        target: job.target,
        payload: job.payload,
        attempts: job.attempts,
        leaseExpiresAt: job.lease_expires_at,
      });
    }

    if (aborted || Date.now() >= deadline) break;
    // Wakes the instant a job is enqueued in this process; otherwise falls
    // through on the slow safety timer. One claim per wake, not per tick.
    const remaining = Math.max(0, deadline - Date.now());
    await waitForPrintJob(target ?? null, Math.min(SAFETY_POLL_MS, remaining), () => aborted);
  }

  // 204, not an empty 200: "nothing for you" is not a job with no fields.
  res.status(204).end();
});

/** The agent got paper out. Terminal, and the only happy path. */
printRouter.post('/jobs/:id/ack', requireAgent, async (req, res) => {
  const data = await db
    .updateTable('print_jobs')
    .set({
      status: 'printed',
      printed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
    })
    .where('id', '=', req.params.id ?? '')
    .where('status', '=', 'leased')
    .where('lease_owner', '=', req.agent!.id)
    .returning('id')
    .executeTakeFirst();

  // Not an error worth shouting about: the lease expired and the sweep already
  // moved the job on. The agent has done its part; the queue state stands.
  if (!data) return res.status(409).json({ error: 'That lease is no longer held by this agent.' });

  res.json({ ok: true });
});

/**
 * The agent could not print it.
 *
 * `reachedPrinter` decides everything. See printFailBodySchema for why that
 * one boolean carries the whole safety property.
 */
printRouter.post('/jobs/:id/fail', requireAgent, async (req, res) => {
  const parsed = printFailBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'reachedPrinter is required.' });
  const { reachedPrinter, error: reason } = parsed.data;

  const jobId = req.params.id ?? '';
  const job = isUuid(jobId)
    ? await db
        .selectFrom('print_jobs')
        .select(['id', 'target', 'attempts', 'max_attempts', 'status', 'lease_owner'])
        .where('id', '=', jobId)
        .executeTakeFirst()
    : undefined;

  if (!job || job.status !== 'leased' || job.lease_owner !== req.agent!.id) {
    return res.status(409).json({ error: 'That lease is no longer held by this agent.' });
  }

  // A receipt that may have reached the printer stops here and waits for a
  // person. Never requeued: no algorithm can see whether paper came out.
  const next: PrintJobStatus =
    reachedPrinter && job.target === 'receipt'
      ? 'unconfirmed'
      : job.attempts < job.max_attempts
        ? 'queued'
        : 'failed';

  await db
    .updateTable('print_jobs')
    .set({
      status: next,
      lease_owner: null,
      lease_expires_at: null,
      last_error: reason ?? null,
    })
    .where('id', '=', job.id)
    .execute();

  // A requeued label is new work for whoever is parked on the label loop.
  if (next === 'queued') notifyPrintJob(job.target);

  res.json({ ok: true, status: next });
});

/** Heartbeat: liveness, version, device health, and double-install detection. */
printRouter.post('/heartbeat', requireAgent, async (req, res) => {
  const parsed = printHeartbeatBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'instanceId is required.' });
  const { agentVersion, instanceId, devices } = parsed.data;

  const agentId = req.agent!.id;
  const current = await db
    .selectFrom('print_agents')
    .select('last_instance_id')
    .where('id', '=', agentId)
    .executeTakeFirst();

  // Two machines running a COPIED token share this row but report different
  // instance ids. Without this the second install is completely invisible;
  // with it, the admin screen can say so out loud.
  const conflict = Boolean(current?.last_instance_id && current.last_instance_id !== instanceId);

  // Best-effort, both: a heartbeat that fails to record is simply a missed
  // heartbeat, and the next one (seconds away) tries again.
  await db
    .updateTable('print_agents')
    .set({
      last_seen_at: new Date().toISOString(),
      agent_version: agentVersion ?? null,
      last_instance_id: instanceId,
      ...(conflict ? { instance_conflict_at: new Date().toISOString() } : {}),
    })
    .where('id', '=', agentId)
    .execute()
    .catch(() => undefined);

  if (devices?.length) {
    await db
      .insertInto('print_device_health')
      .values(
        devices.map((d) => ({
          agent_id: agentId,
          target: d.target,
          status: d.status,
          detail: d.detail ?? null,
          checked_at: new Date().toISOString(),
        })),
      )
      .onConflict((oc) =>
        oc.columns(['agent_id', 'target']).doUpdateSet((eb) => ({
          status: eb.ref('excluded.status'),
          detail: eb.ref('excluded.detail'),
          checked_at: eb.ref('excluded.checked_at'),
        })),
      )
      .execute()
      .catch(() => undefined);
  }

  res.json({ ok: true, isPrimary: req.agent!.isPrimary, instanceConflict: conflict });
});

/** Printer configuration, so the agent never carries its own copy. */
printRouter.get('/config', requireAgent, async (req, res) => {
  const data = await db
    .selectFrom('shops')
    .select('printer_config')
    .where('id', '=', req.agent!.shopId)
    .executeTakeFirst();
  res.json(data?.printer_config ?? {});
});

/* ==========================================================================
 * STAFF — the queue, and answering the unconfirmed question
 * ======================================================================== */

/**
 * The queue, for the admin screen.
 *
 * `?attention=true` narrows to the only two states a human can act on:
 * `unconfirmed` (did paper come out?) and `failed` (retry?). That is the
 * default view, because a list of 100 successfully printed receipts buries the
 * one row that needs somebody.
 *
 * Staff names are resolved HERE rather than shipped as bare ids. That is the
 * standing rule in this codebase and the specific thing that left /admin/cash
 * stuck on a skeleton when it was broken.
 */
printRouter.get('/queue', requireStaff, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const attention = req.query.attention === 'true';

  const queueShop = readShop(req);
  let query = db
    .selectFrom('print_jobs')
    .select([
      'shop_id',
      'id',
      'kind',
      'target',
      'status',
      'attempts',
      'max_attempts',
      'last_error',
      'created_at',
      'printed_at',
      'requested_by',
    ])
    .orderBy('created_at', 'desc')
    .limit(100);
  if (queueShop) query = query.where('shop_id', '=', queueShop);
  if (status) query = query.where('status', '=', status as PrintJobStatus);
  if (attention) query = query.where('status', 'in', ['unconfirmed', 'failed']);

  const rows = await query.execute();
  const names = await staffNamesFor(rows.map((r) => r.requested_by));

  res.json(
    rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      target: r.target,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      lastError: r.last_error,
      createdAt: r.created_at,
      printedAt: r.printed_at,
      requestedBy: r.requested_by,
      requestedByName: r.requested_by ? (names.get(r.requested_by) ?? null) : null,
    })),
  );
});

/**
 * A human answers the one question the system cannot: did paper come out?
 *
 * Requeuing on "reprint" rather than creating a new row keeps the dedupe key
 * meaningful and leaves `attempts` as the honest record that this was printed
 * more than once. `resolved_by` puts a name against the decision.
 *
 * Gated on the SAME per-kind permission as enqueueing, and for the same reason.
 * Resolving "not printed" requeues the job and notifies the agent, so this
 * endpoint produces paper — it is a second path to the exact outcome
 * PERMISSION_FOR_KIND exists to control. Gating only the enqueue side would
 * mean someone refused at POST /print/jobs could still make that receipt come
 * out by reprinting it here, which is the same hole as the `refund_receipt`
 * one, one endpoint along. `kind` is selected purely so this check can be made.
 */
printRouter.post('/jobs/:id/resolve', requireStaff, async (req, res) => {
  const parsed = printResolveBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'outcome is required.' });

  const jobId = req.params.id ?? '';
  const job = isUuid(jobId)
    ? await db
        .selectFrom('print_jobs')
        .select(['id', 'status', 'target', 'kind', 'shop_id'])
        .where('id', '=', jobId)
        .executeTakeFirst()
    : undefined;
  if (!job || !canRead(req, job.shop_id)) {
    return res.status(404).json({ error: 'No such print job.' });
  }

  // An unrecognised kind denies rather than defaults — a new kind added to the
  // enum without a permission entry must fail closed, not print for anyone.
  const needed = PERMISSION_FOR_KIND[job.kind];
  if (!needed || !req.user?.permissions?.includes(needed)) {
    return res.status(403).json({ error: `Missing permission: ${needed ?? 'unknown print kind'}` });
  }

  if (job.status !== 'unconfirmed' && job.status !== 'failed') {
    return res.status(409).json({ error: 'That job is not waiting on a decision.' });
  }

  const printed = parsed.data.outcome === 'printed';
  // No `!` needed: the permission check above reads `req.user?.permissions`,
  // which narrows req.user to non-null here.
  const resolvedBy = req.user.id;
  await db
    .updateTable('print_jobs')
    .set({
      status: printed ? 'printed' : 'queued',
      printed_at: printed ? new Date().toISOString() : null,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .where('id', '=', job.id)
    .execute();

  // "Reprint" is a human deliberately putting work back on the queue — the
  // agent should hear about it now, not on the next safety tick.
  if (!printed) notifyPrintJob(job.target);

  res.json({ ok: true, status: printed ? 'printed' : 'queued' });
});

/* ==========================================================================
 * OWNER — issuing agent tokens
 * ======================================================================== */

/**
 * Issue an agent and its token. The token is returned EXACTLY ONCE, in this
 * response, and only its hash is stored — the same posture as staff PINs.
 * There is deliberately no endpoint that can show it again.
 */
printRouter.post(
  '/agents',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const parsed = printAgentCreateBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'A name is required.' });
    const { name, primary } = parsed.data;
    const agentShop = await writeShop(req, res);
    if (!agentShop) return;

    const token = generateAgentToken();

    // Only one agent may be primary (enforced by a partial unique index), so
    // promoting a new one has to demote the old one first.
    if (primary) {
      await db
        .updateTable('print_agents')
        .set({ is_primary: false })
        .where('is_primary', '=', true)
        .where('shop_id', '=', agentShop)
        .where('revoked_at', 'is', null)
        .execute()
        .catch(() => undefined);
    }

    const data = await db
      .insertInto('print_agents')
      .values({
        name,
        token_hash: hashAgentToken(token),
        is_primary: primary ?? false,
        shop_id: agentShop,
        created_by: req.user!.id,
      })
      .returning(['id', 'name', 'is_primary'])
      .executeTakeFirstOrThrow();

    res.status(201).json({
      id: data.id,
      name: data.name,
      isPrimary: data.is_primary,
      // Shown once. Never recoverable.
      token,
    });
  },
);

printRouter.get('/agents', requireStaff, requirePermission('settings.manage'), async (req, res) => {
  const agentsShop = readShop(req);
  const [data, health, shopRows] = await Promise.all([
    db
      .selectFrom('print_agents')
      .$if(!!agentsShop, (qb) => qb.where('shop_id', '=', agentsShop!))
      .select([
        'shop_id',
        'id',
        'name',
        'is_primary',
        'last_seen_at',
        'agent_version',
        'instance_conflict_at',
        'revoked_at',
        'created_at',
      ])
      .orderBy('created_at')
      .execute(),
    db
      .selectFrom('print_device_health')
      .select(['agent_id', 'target', 'status', 'detail', 'checked_at'])
      .execute(),
    // The owner's own trading hours decide whether silence is a fault or a
    // closed shop. Read here, once, and applied to every agent — see
    // lib/printHealth.ts for why this is not computed in the browser.
    db.selectFrom('shops').select(['id', 'opening_hours']).execute(),
  ]);
  // Each agent is judged against ITS shop's trading hours.
  const hoursByShop = new Map(
    shopRows.map((s) => [s.id, (s.opening_hours ?? []) as unknown as OpeningHoursEntry[]]),
  );
  const now = new Date();

  res.json(
    data.map((a) => {
      const evaluated = evaluateAgentHealth({
        lastSeenAt: a.last_seen_at,
        openingHours: hoursByShop.get(a.shop_id) ?? [],
        now,
      });
      return {
        id: a.id,
        name: a.name,
        isPrimary: a.is_primary,
        lastSeenAt: a.last_seen_at,
        agentVersion: a.agent_version,
        instanceConflictAt: a.instance_conflict_at,
        revokedAt: a.revoked_at,
        /** 'ok' | 'stale' | 'asleep' | 'down' | 'never_seen'. */
        health: evaluated.health,
        shopOpen: evaluated.shopOpen,
        secondsSinceSeen: evaluated.secondsSinceSeen,
        devices: health
          .filter((h) => h.agent_id === a.id)
          .map((h) => ({
            target: h.target,
            status: h.status,
            detail: h.detail,
            checkedAt: h.checked_at,
          })),
      };
    }),
  );
});
