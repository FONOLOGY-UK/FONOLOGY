import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { attachSession } from './middleware/auth.js';
import { wrapHandler } from './lib/router.js';
import { authRouter } from './routes/auth.routes.js';
import { staffRouter } from './routes/staff.routes.js';
import { guestRouter } from './routes/guest.routes.js';
import { productsRouter, categoriesRouter } from './routes/products.routes.js';
import { ordersRouter } from './routes/orders.routes.js';
import { posRouter } from './routes/pos.routes.js';
import { repairsRouter } from './routes/repairs.routes.js';
import { jobsRouter } from './routes/jobs.routes.js';
import { sellRouter } from './routes/sell.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { reportsRouter } from './routes/reports.routes.js';
import { printRouter } from './routes/print.routes.js';
import { shopRouter } from './routes/shop.routes.js';
import { reviewsRouter } from './routes/reviews.routes.js';
import { webhooksRouter } from './routes/webhooks.routes.js';
import { expirePrintLeases } from './lib/printRetention.js';

const app = express();

/**
 * Red-team finding #3 (HIGH, confirmed — no `trust proxy` setting existed
 * anywhere in this app before this line). Without telling Express which
 * hops in front of it to trust, `req.ip` reads the raw socket peer address
 * rather than anything from `X-Forwarded-For`, and that silently breaks
 * every IP-keyed thing in this app: `isRateLimited(req.ip, ...)`
 * (staff/customer signin, password-reset, order/sell-request lookup) either
 * never trips (every caller looks like the same one busy source) or trips
 * on one shared address and blocks every legitimate customer at once.
 *
 * `2`, NOT `1` — CONFIRMED AGAINST THE REAL DEPLOYED TOPOLOGY, NOT GUESSED.
 * This was originally set to `1` on the assumption of a single Render
 * reverse-proxy hop, per Render's own docs. That assumption was wrong for
 * this app's actual traffic path, and it produced a real, live bug
 * (client-readiness report: an endpoint capped at 10 requests/10min let 12
 * straight through, and a 25-request burst produced an erratic scatter of
 * 429s instead of a clean threshold — the signature of requests landing on
 * several different rotating identities rather than one).
 *
 * Diagnosed with a temporary `/debug/ip` endpoint hit repeatedly from the
 * live site (not locally — this class of bug doesn't reproduce locally,
 * which is exactly why it survived). Every request's `X-Forwarded-For` had
 * TWO entries, e.g. `"175.107.255.82, 172.68.249.154"`: the first address
 * was IDENTICAL across every request — the real, stable client — and the
 * second was a different Cloudflare edge IP every time (172.68.x,
 * 172.70.x, 162.158.x, 172.71.x — all Cloudflare-owned ranges). So the
 * actual path is browser -> Cloudflare edge (adds the real client IP) ->
 * Render's own reverse proxy (appends its own hop) -> this app — two hops,
 * not one. `trust proxy: 1` only trusts the invisible direct socket peer
 * (Render's internal load balancer) and stops there, landing on the
 * *varying* Cloudflare hop as `req.ip` — which is exactly why the limiter
 * looked like it was bucketing requests under rotating identities: it was.
 * `2` trusts that plus the Cloudflare hop, landing on the real, stable
 * client address every time.
 *
 * Re-confirm this against real traffic (the same way, not by re-reasoning
 * about it) before ever changing it again — trusting too many hops lets a
 * client forge its own X-Forwarded-For and pick whatever IP it wants to be
 * rate-limited as; trusting too few is this exact bug, just with a
 * different wrong number.
 *
 * IMPORTANT — SINGLE-INSTANCE ONLY. `isRateLimited` (lib/rateLimit.ts) is
 * an in-memory Map, correct only when exactly one process is holding it —
 * true today (`fonology-api` is one instance, no autoscaling configured
 * anywhere in this file or render.yaml). If this service is ever scaled
 * horizontally, each instance gets its own counter and the effective limit
 * multiplies by the instance count — the limiter needs to move to a shared
 * store (Redis or the database) BEFORE that happens, not after.
 */
app.set('trust proxy', 2);

/**
 * `INTERNAL_PROXY_SECRET` unset is a legitimate, supported state (see
 * config.ts and lib/clientIp.ts) — both features built on it fail SOFT by
 * design, not by accident: the rate limiter falls back to plain `req.ip`,
 * and PDP revalidation callbacks just never fire. That's the right runtime
 * behaviour (an internal wiring gap between two of this project's own
 * services should never crash the API), but "correct and silent" is also
 * exactly how this kind of gap survives for months — the rate limiter
 * quietly keying on the wrong IP for every proxied request, or product
 * pages quietly staying stale, with nothing in the logs to say why. One
 * line at boot, once, trades that invisibility for a log line an operator
 * can actually go looking for.
 */
if (!config.internalProxySecret) {
  // eslint-disable-next-line no-console
  console.warn(
    '[api] INTERNAL_PROXY_SECRET is not set — the rate limiter will not see ' +
      "the real client IP for requests arriving via apps/web's /api-proxy, and " +
      '/api-internal/revalidate-product callbacks after a product edit will be ' +
      'skipped. Both fail soft (see lib/clientIp.ts, lib/revalidate.ts) rather ' +
      'than crash the API, but this is very likely a misconfiguration, not an ' +
      'intentional choice — set the same value on both fonology-api and ' +
      'fonology-web (render.yaml: fonology-shared env var group) if it should be.',
  );
}

app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  }),
);
/**
 * Payment webhooks are mounted HERE, above express.json(), and the order is
 * not cosmetic.
 *
 * Stripe signs the raw bytes of the request body. Once express.json() has
 * parsed a body, those bytes are gone — re-serialising the object produces a
 * different byte sequence and the signature will never verify again. The
 * webhook router therefore brings its own express.raw() and has to be reached
 * before the global JSON parser gets a look at the request.
 *
 * It also sits above `attachSession` deliberately. A webhook carries no
 * cookie and belongs to no person; its authenticity comes entirely from the
 * signature check inside the handler. Running session middleware over it would
 * suggest an identity that is not there.
 *
 * Moving this line below express.json() breaks every incoming payment
 * confirmation, silently, with a signature error that looks like a wrong
 * secret. Leave it where it is.
 */
app.use('/webhooks', webhooksRouter);

app.use(express.json());
app.use(cookieParser());
// `attachSession` is async and sits in front of EVERY route, so a rejection
// here would escape the same way a route handler's would — and take out the
// whole API rather than one endpoint. The routers wrap their own handlers
// (lib/router.ts); app-level middleware has to be wrapped at the mount point.
app.use(wrapHandler(attachSession));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Public, unauthenticated, and deliberately so — see shop.routes.ts for what
// is and is not exposed. The storefront and the till both read it.
app.use('/shop', shopRouter);
// Same posture as /shop — public, published reviews only, see
// reviews.routes.ts's own comment.
app.use('/reviews', reviewsRouter);
app.use('/auth', authRouter);
app.use('/staff', staffRouter);
app.use('/guest', guestRouter);
app.use('/products', productsRouter);
app.use('/categories', categoriesRouter);
app.use('/orders', ordersRouter);
app.use('/pos', posRouter);
app.use('/repair', repairsRouter);
app.use('/jobs', jobsRouter);
app.use('/sell', sellRouter);
app.use('/admin', adminRouter);
app.use('/reports', reportsRouter);
// The only router whose endpoints are reachable with a device token rather
// than a person's session — see middleware/agentAuth.ts for why that token is
// scoped this narrowly.
app.use('/print', printRouter);

/**
 * The single place a failed request turns into a response.
 *
 * Every router is built by `createRouter()`, which routes handler rejections
 * into `next(err)`, so async failures arrive here rather than escaping to the
 * process. The client gets a generic message on purpose — the detail goes to
 * the log, not to the counter.
 */
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(`[api] request failed: ${req.method} ${req.originalUrl}`, err);
  // If the response has already started, the only correct move is to let
  // Express tear the connection down — writing a second time would corrupt
  // whatever was already sent.
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error.' });
});

/**
 * Last resort, and it should now never fire.
 *
 * Handler rejections are caught at registration time (lib/router.ts) and
 * app-level async middleware is wrapped at its mount point, so anything
 * reaching here escaped from somewhere those two don't cover — a timer, an
 * event handler, a floating promise in a library. Node's default for an
 * unhandled rejection is to kill the process, which in this app means every
 * till in the shop goes down mid-shift. Staying up is the right trade.
 *
 * Logged as UNCAUGHT with the stack so a swallowed rejection is obvious in the
 * log rather than silent: if this line ever appears, something is escaping the
 * wrapper and the wrapper is what needs fixing.
 */
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error(
    '[api] UNCAUGHT REJECTION — escaped the async router wrapper, process kept alive.\n' +
      '      This should not happen; the wrapper in lib/router.ts needs to cover it.\n' +
      '      Reason:',
    reason instanceof Error ? (reason.stack ?? reason.message) : reason,
  );
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${config.port}`);
});

/**
 * Red-team finding #6e (MEDIUM, confirmed — `expirePrintLeases` was only
 * ever invoked from `scripts/purge-print-jobs.ts`, the Render cron job
 * whose OWN function, `expirePrintLeases`'s own doc comment says, is meant
 * to "run far more often" than that. In practice both functions the script
 * calls shared whatever single cron cadence that job was actually given —
 * appropriate for `purgeExpiredPrintJobs` (a daily retention purge), much
 * too slow for lease expiry: a till PC that died mid-print left its job
 * stuck `leased` until the next cron tick, rather than recovering within
 * about a minute the way the print system's own design (0033) intends.
 *
 * This runs INSIDE the long-lived apps/api server process instead — the
 * cron job stays exactly as it was, still daily, still calling
 * purgeExpiredPrintJobs for actual data retention; this is a second,
 * separate, much tighter loop for the operational recovery concern only.
 * 90 seconds is this system's own real lease length (LEASE_SECONDS,
 * apps/print-agent/src/worker.ts) — a 60s sweep catches an expired lease
 * within one tick of it actually going stale, not tied to that constant so
 * the two can be tuned independently.
 *
 * Confirmed this doesn't double up with anything apps/print-agent does on
 * its own: the agent only ever CLAIMS a lease and reacts to one already
 * having expired server-side (worker.ts's LeaseLostError handling) — it
 * never runs its own expiry sweep, so there is exactly one place leases
 * get reclaimed, same as before, just running on the right cadence now.
 *
 * Failures are logged and swallowed, deliberately — a transient DB blip on
 * one tick must not crash the API or stop the next tick sixty seconds
 * later from trying again.
 */
setInterval(() => {
  expirePrintLeases().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[api] expirePrintLeases tick failed:', err);
  });
}, 60_000).unref();
