import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { attachSession } from './middleware/auth.js';
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

const app = express();

app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(attachSession);

app.get('/health', (_req, res) => res.json({ ok: true }));

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('[api] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  },
);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${config.port}`);
});
