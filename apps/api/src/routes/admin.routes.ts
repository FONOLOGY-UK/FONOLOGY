import { adminProductsRouter } from './admin/products.js';
import { adminVariantsRouter } from './admin/variants.js';
import { adminCategoriesRouter } from './admin/categories.js';
import { adminProductFoldersRouter } from './admin/product-folders.js';
import { adminPromotionsRouter } from './admin/promotions.js';
import { adminStaffRouter } from './admin/staff.js';
import { adminSettingsRouter } from './admin/settings.js';
import { adminLabelsRouter } from './admin/labels.js';
import { adminReviewsRouter } from './admin/reviews.js';
import { adminDevicesRouter } from './admin/devices.js';
import { adminRepairTypesRouter } from './admin/repair-types.js';
import { adminBarcodesRouter } from './admin/barcodes.js';
import { createRouter } from '../lib/router.js';

/**
 * The admin API, one sub-router per domain under ./admin/. Mounted in the order the
 * routes were originally registered, so Express matching is unchanged (e.g. '/products/low-stock'
 * before '/products/:id').
 */
export const adminRouter = createRouter();

adminRouter.use(adminProductsRouter);
adminRouter.use(adminVariantsRouter);
adminRouter.use(adminCategoriesRouter);
adminRouter.use(adminProductFoldersRouter);
adminRouter.use(adminPromotionsRouter);
adminRouter.use(adminStaffRouter);
adminRouter.use(adminSettingsRouter);
adminRouter.use(adminLabelsRouter);
adminRouter.use(adminReviewsRouter);
adminRouter.use(adminDevicesRouter);
adminRouter.use(adminRepairTypesRouter);
adminRouter.use(adminBarcodesRouter);
