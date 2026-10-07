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
import { adminDeliveryRouter } from './admin/delivery.js';
import { adminInventoryLogsRouter } from './admin/inventory-logs.js';
import { adminNotificationsRouter } from './admin/notifications.js';
import { adminBarcodesRouter } from './admin/barcodes.js';
import { adminMasterRouter } from './admin/master.js';
import { adminShopsRouter } from './admin/shops.js';
import { createRouter } from '../lib/router.js';
import { isUuid } from '../lib/uuid.js';
import { canRead, canWrite } from '../lib/shopScope.js';
import { productById } from './admin/products.js';
import { hideCosts } from '../lib/costs.js';

/**
 * The admin API, one sub-router per domain under ./admin/. Mounted in the order the
 * routes were originally registered, so Express matching is unchanged (e.g. '/products/low-stock'
 * before '/products/:id').
 */
export const adminRouter = createRouter();

/**
 * Every /products/:id/... route (stock, receive, variants, restore, delete …) acts on one
 * product, which belongs to one shop. Checked once here rather than in each handler: reading
 * needs read access to that shop, anything else needs write access. A product outside the
 * caller's reach reads as not found. (Non-uuid ids such as 'barcode' and 'low-stock' pass
 * straight through to their own routes.)
 */
adminRouter.use('/products/:id', async (req, res, next) => {
  if (!req.user || req.user.kind !== 'staff' || !isUuid(req.params.id)) return next();
  const product = await productById(req.params.id);
  if (!product) return next(); // the handler answers 404 itself
  const allowed =
    req.method === 'GET' ? canRead(req, product.shop_id) : canWrite(req, product.shop_id);
  if (!allowed) return res.status(404).json({ error: 'Product not found.' });
  next();
});

// Cost prices (and the cost-based inventory value) only go to people with costs.view.
adminRouter.use(
  ['/products', '/master', '/inventory'],
  hideCosts('costPrice', 'totalValuePence', 'retiredValuePence'),
);

adminRouter.use(adminShopsRouter);
adminRouter.use(adminMasterRouter);
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
adminRouter.use(adminDeliveryRouter);
adminRouter.use(adminInventoryLogsRouter);
adminRouter.use(adminNotificationsRouter);
adminRouter.use(adminBarcodesRouter);
