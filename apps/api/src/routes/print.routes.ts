import { supabaseAdmin } from '../lib/supabase.js';
import { createRouter } from '../lib/router.js';
import { requireStaff, requirePermission } from '../middleware/auth.js';
import { requireAgent, generateAgentToken, hashAgentToken } from '../middleware/agentAuth.js';
import { buildPrintPayload, PrintPayloadError, TARGET_FOR_KIND } from '../lib/printPayloads.js';
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
 */
const PERMISSION_FOR_KIND = {
  sale_receipt: 'pos.operate',
  refund_receipt: 'pos.operate',
  payout_receipt: 'tradein.manage',
  job_label: 'jobs.manage',
  shelf_label: 'inventory.manage',
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
  const { kind, entityId, dedupeKey } = parsed.data;

  const needed = PERMISSION_FOR_KIND[kind];
  if (!req.user?.permissions?.includes(needed as never)) {
    return res.status(403).json({ error: `Missing permission: ${needed}` });
  }

  const existing = await supabaseAdmin
    .from('print_jobs')
    .select('id, status')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();
  if (existing.data) {
    return res
      .status(200)
      .json({ id: existing.data.id, status: existing.data.status, duplicate: true });
  }

  let payload;
  try {
    payload = await buildPrintPayload(kind, entityId);
  } catch (err) {
    if (err instanceof PrintPayloadError) return res.status(400).json({ error: err.message });
    throw err;
  }

  const { data, error } = await supabaseAdmin
    .from('print_jobs')
    .insert({
      kind,
      target: TARGET_FOR_KIND[kind],
      payload,
      dedupe_key: dedupeKey,
      requested_by: req.user!.id,
    })
    .select('id, status')
    .single();

  // Lost a race against a concurrent enqueue of the same key — still a no-op.
  if (error?.code === '23505') {
    const again = await supabaseAdmin
      .from('print_jobs')
      .select('id, status')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    return res
      .status(200)
      .json({ id: again.data?.id, status: again.data?.status, duplicate: true });
  }
  if (error) throw error;

  // Wake any agent already parked on a long-poll. This is the whole reason
  // enqueue→paper is fast rather than "within the next tick".
  notifyPrintJob(TARGET_FOR_KIND[kind]);

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
    const { data, error } = await supabaseAdmin.rpc('claim_print_job', {
      p_agent_id: req.agent!.id,
      p_lease_seconds: lease,
      p_target: target ?? null,
    });

    if (error) {
      // Raised by the function when this agent is not the primary. A second
      // install must be told plainly rather than left looking idle.
      if (error.code === 'P0001') {
        return res.status(409).json({
          error:
            'This agent is not the primary print agent. Another agent is already handling the queue.',
        });
      }
      throw error;
    }

    const job = Array.isArray(data) ? data[0] : data;
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
  const { data, error } = await supabaseAdmin
    .from('print_jobs')
    .update({
      status: 'printed',
      printed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
    })
    .eq('id', req.params.id)
    .eq('status', 'leased')
    .eq('lease_owner', req.agent!.id)
    .select('id')
    .maybeSingle();
  if (error) throw error;

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

  const { data: job } = await supabaseAdmin
    .from('print_jobs')
    .select('id, target, attempts, max_attempts, status, lease_owner')
    .eq('id', req.params.id)
    .maybeSingle();

  if (!job || job.status !== 'leased' || job.lease_owner !== req.agent!.id) {
    return res.status(409).json({ error: 'That lease is no longer held by this agent.' });
  }

  // A receipt that may have reached the printer stops here and waits for a
  // person. Never requeued: no algorithm can see whether paper came out.
  const next =
    reachedPrinter && job.target === 'receipt'
      ? 'unconfirmed'
      : job.attempts < job.max_attempts
        ? 'queued'
        : 'failed';

  const { error: updateError } = await supabaseAdmin
    .from('print_jobs')
    .update({
      status: next,
      lease_owner: null,
      lease_expires_at: null,
      last_error: reason ?? null,
    })
    .eq('id', job.id);
  if (updateError) throw updateError;

  // A requeued label is new work for whoever is parked on the label loop.
  if (next === 'queued') notifyPrintJob(job.target as 'receipt' | 'label');

  res.json({ ok: true, status: next });
});

/** Heartbeat: liveness, version, device health, and double-install detection. */
printRouter.post('/heartbeat', requireAgent, async (req, res) => {
  const parsed = printHeartbeatBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'instanceId is required.' });
  const { agentVersion, instanceId, devices } = parsed.data;

  const { data: current } = await supabaseAdmin
    .from('print_agents')
    .select('last_instance_id')
    .eq('id', req.agent!.id)
    .maybeSingle();

  // Two machines running a COPIED token share this row but report different
  // instance ids. Without this the second install is completely invisible;
  // with it, the admin screen can say so out loud.
  const conflict = Boolean(current?.last_instance_id && current.last_instance_id !== instanceId);

  await supabaseAdmin
    .from('print_agents')
    .update({
      last_seen_at: new Date().toISOString(),
      agent_version: agentVersion ?? null,
      last_instance_id: instanceId,
      ...(conflict ? { instance_conflict_at: new Date().toISOString() } : {}),
    })
    .eq('id', req.agent!.id);

  if (devices?.length) {
    await supabaseAdmin.from('print_device_health').upsert(
      devices.map((d) => ({
        agent_id: req.agent!.id,
        target: d.target,
        status: d.status,
        detail: d.detail ?? null,
        checked_at: new Date().toISOString(),
      })),
      { onConflict: 'agent_id,target' },
    );
  }

  res.json({ ok: true, isPrimary: req.agent!.isPrimary, instanceConflict: conflict });
});

/** Printer configuration, so the agent never carries its own copy. */
printRouter.get('/config', requireAgent, async (_req, res) => {
  const { data } = await supabaseAdmin
    .from('shop_settings')
    .select('printer_config')
    .limit(1)
    .maybeSingle();
  res.json(data?.printer_config ?? {});
});

/* ==========================================================================
 * STAFF — the queue, and answering the unconfirmed question
 * ======================================================================== */

printRouter.get('/queue', requireStaff, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  let query = supabaseAdmin
    .from('print_jobs')
    .select('id, kind, target, status, attempts, last_error, created_at, printed_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  res.json(data ?? []);
});

/**
 * A human answers the one question the system cannot: did paper come out?
 *
 * Requeuing on "reprint" rather than creating a new row keeps the dedupe key
 * meaningful and leaves `attempts` as the honest record that this was printed
 * more than once. `resolved_by` puts a name against the decision.
 */
printRouter.post('/jobs/:id/resolve', requireStaff, async (req, res) => {
  const parsed = printResolveBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'outcome is required.' });

  const { data: job } = await supabaseAdmin
    .from('print_jobs')
    .select('id, status, target')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!job) return res.status(404).json({ error: 'No such print job.' });
  if (job.status !== 'unconfirmed' && job.status !== 'failed') {
    return res.status(409).json({ error: 'That job is not waiting on a decision.' });
  }

  const printed = parsed.data.outcome === 'printed';
  const { error } = await supabaseAdmin
    .from('print_jobs')
    .update({
      status: printed ? 'printed' : 'queued',
      printed_at: printed ? new Date().toISOString() : null,
      resolved_by: req.user!.id,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', job.id);
  if (error) throw error;

  // "Reprint" is a human deliberately putting work back on the queue — the
  // agent should hear about it now, not on the next safety tick.
  if (!printed) notifyPrintJob(job.target as 'receipt' | 'label');

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

    const token = generateAgentToken();

    // Only one agent may be primary (enforced by a partial unique index), so
    // promoting a new one has to demote the old one first.
    if (primary) {
      await supabaseAdmin
        .from('print_agents')
        .update({ is_primary: false })
        .eq('is_primary', true)
        .is('revoked_at', null);
    }

    const { data, error } = await supabaseAdmin
      .from('print_agents')
      .insert({
        name,
        token_hash: hashAgentToken(token),
        is_primary: primary ?? false,
        created_by: req.user!.id,
      })
      .select('id, name, is_primary')
      .single();
    if (error) throw error;

    res.status(201).json({
      id: data.id,
      name: data.name,
      isPrimary: data.is_primary,
      // Shown once. Never recoverable.
      token,
    });
  },
);

printRouter.get(
  '/agents',
  requireStaff,
  requirePermission('settings.manage'),
  async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from('print_agents')
      .select(
        'id, name, is_primary, last_seen_at, agent_version, instance_conflict_at, revoked_at, created_at',
      )
      .order('created_at');
    if (error) throw error;

    const { data: health } = await supabaseAdmin
      .from('print_device_health')
      .select('agent_id, target, status, detail, checked_at');

    res.json(
      (data ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        isPrimary: a.is_primary,
        lastSeenAt: a.last_seen_at,
        agentVersion: a.agent_version,
        instanceConflictAt: a.instance_conflict_at,
        revokedAt: a.revoked_at,
        devices: (health ?? [])
          .filter((h) => h.agent_id === a.id)
          .map((h) => ({
            target: h.target,
            status: h.status,
            detail: h.detail,
            checkedAt: h.checked_at,
          })),
      })),
    );
  },
);
