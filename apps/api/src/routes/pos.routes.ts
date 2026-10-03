import { posSalesRouter } from './pos/sales.js';
import { posTodayRouter } from './pos/today.js';
import { posRefundsRouter } from './pos/refunds.js';
import { posCashRouter } from './pos/cash.js';
import { posDayCloseRouter } from './pos/day-close.js';
import { posFavouritesRouter } from './pos/favourites.js';
import { posMiscLinesRouter } from './pos/misc-lines.js';
import { posCardLimitsRouter } from './pos/card-limits.js';
import { createRouter } from '../lib/router.js';

/**
 * The till API, one sub-router per concern under ./pos/. Mounted in the order the routes
 * were originally registered, so Express matching is unchanged.
 */
export const posRouter = createRouter();

posRouter.use(posSalesRouter);
posRouter.use(posTodayRouter);
posRouter.use(posRefundsRouter);
posRouter.use(posCashRouter);
posRouter.use(posDayCloseRouter);
posRouter.use(posFavouritesRouter);
posRouter.use(posMiscLinesRouter);
posRouter.use(posCardLimitsRouter);
