import { posSalesRouter } from './pos/sales.js';
import { posJobPaymentsRouter } from './pos/job-payments.js';
import { posTodayRouter } from './pos/today.js';
import { posRefundsRouter } from './pos/refunds.js';
import { posCashRouter } from './pos/cash.js';
import { posDayCloseRouter } from './pos/day-close.js';
import { posFavouritesRouter } from './pos/favourites.js';
import { posMiscLinesRouter } from './pos/misc-lines.js';
import { posCardLimitsRouter } from './pos/card-limits.js';
import { createRouter } from '../lib/router.js';
import { hideCosts } from '../lib/costs.js';

/**
 * The till API, one sub-router per concern under ./pos/. Mounted in the order the routes
 * were originally registered, so Express matching is unchanged.
 */
export const posRouter = createRouter();

// A completed sale's cost and per-line cost prices are margin data (costs.view).
posRouter.use('/sales', hideCosts('cost', 'costPrice'));
posRouter.use(posSalesRouter);
posRouter.use(posJobPaymentsRouter);
posRouter.use(posTodayRouter);
posRouter.use(posRefundsRouter);
posRouter.use(posCashRouter);
posRouter.use(posDayCloseRouter);
posRouter.use(posFavouritesRouter);
posRouter.use(posMiscLinesRouter);
posRouter.use(posCardLimitsRouter);
