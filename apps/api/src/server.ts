import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { config, assertServerConfig } from './config.js';
import { ALL_SHOPS_VIEW_ONLY_MESSAGE } from './lib/shopScope.js';
import {
  attachSession,
  blockLockedWrites,
  blockPosOnlySession,
  requireTrustedOrigin,
} from './middleware/auth.js';
import { wrapHandler } from './lib/router.js';
import { authRouter } from './routes/auth.routes.js';
import { staffRouter } from './routes/staff.routes.js';
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
import { shopsRouter } from './routes/shops.routes.js';
import { reviewsRouter } from './routes/reviews.routes.js';
import { webhooksRouter } from './routes/webhooks.routes.js';
import { expirePrintLeases } from './lib/printRetention.js';
import { initDb, pool } from './lib/db.js';

const app = express();

/**
 * `TRUST_PROXY_HOPS` (config.ts) says how many reverse proxies sit in front of this process: 1 behind
 * Traefik alone, 2 with Cloudflare in front. Express uses it to pick the real client address out of
 * X-Forwarded-For, and every IP-keyed limiter (lib/rateLimit.ts) depends on it: too low and requests
 * share the proxy's address, too high and a client can forge its own. Check it against real traffic
 * (the first X-Forwarded-For entry should be stable per client) rather than reasoning about it.
 *
 * Single-instance only: the limiter is an in-memory Map. Before running a second API instance it has to
 * move to a shared store (the database or Redis), or each instance gets its own counter.
 */
app.set('trust proxy', config.trustProxyHops);

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
// eslint-disable-next-line no-console
console.log(
  `[api] trusting ${config.trustProxyHops} proxy hop(s) for the client address (TRUST_PROXY_HOPS)`,
);

// INTERNAL_PROXY_SECRET unset is allowed (the rate limiter then ignores the web proxy's forwarded client
// address), but is almost always a misconfiguration, so say so once at boot.
if (!config.internalProxySecret) {
  // eslint-disable-next-line no-console
  console.warn(
    '[api] INTERNAL_PROXY_SECRET is not set — the rate limiter will not see the real client IP for ' +
      "requests arriving via apps/web's /api-proxy. Set the same value on fonology-api and fonology-web " +
      'if that route is in use.',
  );
}

app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  }),
);
// gzip for anything over 1 kB — the report and list endpoints return hundreds
// of kB of repetitive JSON, which compresses roughly tenfold.
app.use(compression({ threshold: 1024 }));
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
// A cookie-authenticated write from an origin that is not ours is refused (CSRF).
app.use(requireTrustedOrigin);
// `attachSession` is async and sits in front of EVERY route, so a rejection
// here would escape the same way a route handler's would — and take out the
// whole API rather than one endpoint. The routers wrap their own handlers
// (lib/router.ts); app-level middleware has to be wrapped at the mount point.
app.use(wrapHandler(attachSession));
// A locked till session may not write anything (except unlock / switch / lock / sign-out).
app.use(blockLockedWrites);

// "All shops" = view only. The dashboard sends `shop=all` while every shop is
// shown; a change made then has no shop to land in, so EVERY write naming it is refused here, for
// every route at once — the admin panel's own guard is a courtesy, this is the rule. Printing is
// output, not a change, and the print route resolves its own shop.
app.use((req, res, next) => {
  const write = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (write && req.query.shop === 'all' && !req.path.startsWith('/print/')) {
    return res.status(403).json({ error: ALL_SHOPS_VIEW_ONLY_MESSAGE });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));
// Readiness: can this instance actually reach its database? /health stays shallow on purpose (it is
// the container's liveness check — a database blip must not restart a healthy API); point the
// uptime monitor at this one.
app.get('/health/ready', async (_req, res) => {
  try {
    await pool.query('select 1');
    return res.json({ ok: true, db: true });
  } catch {
    return res.status(503).json({ ok: false, db: false });
  }
});

// Public, unauthenticated, and deliberately so — see shop.routes.ts for what
// is and is not exposed. The storefront and the till both read it.
app.use('/shop', shopRouter);
// Same posture as /shop — public, published reviews only, see
// reviews.routes.ts's own comment.
app.use('/reviews', reviewsRouter);
// The shops a signed-in member of staff can see (the switcher, the till's shop label).
app.use('/shops', shopsRouter);
app.use('/auth', authRouter);
app.use('/staff', staffRouter);
app.use('/products', productsRouter);
app.use('/categories', categoriesRouter);
app.use('/orders', ordersRouter);
app.use('/pos', posRouter);
app.use('/repair', repairsRouter);
app.use('/jobs', jobsRouter);
app.use('/sell', sellRouter);
// Item 4: the admin surface is refused outright to a PIN-switched till
// session, before any route or permission check. Mounted here rather than
// per-route so a route added later cannot forget it.
app.use('/admin', blockPosOnlySession, adminRouter);
app.use('/reports', blockPosOnlySession, reportsRouter);
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
  const status = (err as { status?: unknown } | null)?.status;
  const clientErrorStatus =
    typeof status === 'number' && status >= 400 && status < 500 ? status : null;
  if (clientErrorStatus === null) {
    // eslint-disable-next-line no-console
    console.error(`[api] request failed: ${req.method} ${req.originalUrl}`, err);
  }
  // If the response has already started, the only correct move is to let
  // Express tear the connection down — writing a second time would corrupt
  // whatever was already sent.
  if (res.headersSent) return next(err);
  // Malformed or oversized request bodies are the caller's mistake, not a server failure: body-parser tags
  // them with a 4xx status. They were answered 500 (and logged with a stack) before.
  if (clientErrorStatus !== null) {
    return res.status(clientErrorStatus).json({
      error:
        clientErrorStatus === 413
          ? 'That request is too large.'
          : 'That request could not be read.',
    });
  }
  res.status(500).json({ error: 'Internal server error.' });
});

/**
 * Last resort — it should never fire. Handler rejections are caught at registration (lib/router.ts) and
 * app-level async middleware is wrapped at its mount point, so anything arriving here escaped from a
 * timer, an event handler or a floating promise in a library. Node's default is to exit, which would take
 * every till in the shop down mid-shift; staying up is the better trade. The log line says what to fix.
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

// Server-only environment guard — see assertServerConfig. Deliberately here and
// not at import time, so the cron scripts that share this config module are not
// held to HTTP-server requirements they have no use for.
assertServerConfig();

// Enum-array parsers need the database's own type oids (lib/db.ts), and a
// database we cannot reach is a reason not to start at all.
await initDb();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${config.port}`);
});

// A deploy sends SIGTERM. Stop taking new connections, let in-flight requests (a sale, a payment
// webhook) finish, then close the database pool — rather than cutting them off mid-write.
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[api] ${signal} — finishing in-flight requests, then exiting`);
    const force = setTimeout(() => process.exit(1), 25_000);
    force.unref();
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    // Idle keep-alive sockets (every browser holds some) would otherwise keep close() waiting until the
    // 25 s force-exit above, stalling every deploy; in-flight requests are not idle and still finish.
    server.closeIdleConnections();
  });
}

/**
 * Recover print leases whose till PC died mid-print (a lease is LEASE_SECONDS in the print agent). The daily
 * purge job is too slow for that, so the server sweeps every minute. Failures are logged and swallowed: a
 * database blip on one tick must not stop the next.
 */
setInterval(() => {
  expirePrintLeases().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[api] expirePrintLeases tick failed:', err);
  });
}, 60_000).unref();
