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

const app = express();

app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  }),
);
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
