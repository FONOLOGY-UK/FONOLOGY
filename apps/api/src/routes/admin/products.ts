import type { Request } from 'express';
import { attempt, db, rpc, type DbError } from '../../lib/db.js';
import { isUuid } from '../../lib/uuid.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { artForCategory, DEFAULT_TILE, filterValidImageUrls } from '../../lib/productMapping.js';
import { revalidateProductPage } from '../../lib/revalidate.js';
import {
  uploadProductImageMiddleware,
  uploadProductImage,
  deleteProductImage,
  ImageTooLargeError,
} from '../../lib/productImages.js';
import {
  uploadBuyInFormMiddleware,
  uploadBuyInForm,
  signBuyInFormUrl,
  buyInFormDisplayName,
} from '../../lib/buyInForms.js';
import { productInputBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { canRead, canWrite, readShop, writeShop } from '../../lib/shopScope.js';
import { canSeeCosts } from '../../lib/costs.js';

export const adminProductsRouter = createRouter();
const router = adminProductsRouter;

/* ---------------------------------------------------------------------- */
/* Products — full admin shape, including stock_qty and cost_price          */
/* ---------------------------------------------------------------------- */

/** The full product row, or undefined — including for an id that is not a uuid. */
export async function productById(id: string | undefined) {
  if (!isUuid(id)) return undefined;
  return db.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirst();
}

/** A product the caller may see (or, with write, change); undefined otherwise — reads as not found. */
export async function productForRequest(req: Request, id: string | undefined, write = false) {
  const product = await productById(id);
  if (!product) return undefined;
  return (write ? canWrite(req, product.shop_id) : canRead(req, product.shop_id))
    ? product
    : undefined;
}

export async function variantById(id: string | undefined) {
  if (!isUuid(id)) return undefined;
  return db.selectFrom('product_variants').selectAll().where('id', '=', id).executeTakeFirst();
}

/** Images, supplier names and categories for a set of products, three queries however many rows. */
async function loadProductLookups(rows: Record<string, unknown>[]) {
  const ids = rows.map((r) => r.id as string);
  const supplierIds = [
    ...new Set(rows.map((r) => r.supplier_id as string | null).filter(Boolean)),
  ] as string[];
  const categoryIds = [
    ...new Set(rows.map((r) => r.category_id as string | null).filter(Boolean)),
  ] as string[];
  const [images, suppliers, categories] = await Promise.all([
    ids.length
      ? db
          .selectFrom('product_images')
          .select(['product_id', 'url'])
          .where('product_id', 'in', ids)
          .orderBy('position')
          .execute()
      : [],
    supplierIds.length
      ? db.selectFrom('suppliers').select(['id', 'name']).where('id', 'in', supplierIds).execute()
      : [],
    // category_id (FEATURE-05, migration 0045) is the source of truth now —
    // products.category is frozen and no longer read here.
    categoryIds.length
      ? db
          .selectFrom('categories')
          .select(['id', 'slug', 'label'])
          .where('id', 'in', categoryIds)
          .execute()
      : [],
  ]);
  const imagesByProduct = new Map<string, string[]>();
  for (const img of images) {
    const list = imagesByProduct.get(img.product_id) ?? [];
    list.push(img.url);
    imagesByProduct.set(img.product_id, list);
  }
  return {
    imagesByProduct,
    supplierNames: new Map(suppliers.map((x) => [x.id, x.name])),
    categorySlugs: new Map(categories.map((x) => [x.id, x.slug])),
  };
}

type ProductLookups = Awaited<ReturnType<typeof loadProductLookups>>;

/** A product list in the full admin shape — the lookups are batched, not per row. */
export async function toAdminProducts(rows: Record<string, unknown>[]) {
  const lookups = await loadProductLookups(rows);
  return rows.map((row) => shapeAdminProduct(row, lookups));
}

export async function toAdminProduct(row: Record<string, unknown>) {
  return (await toAdminProducts([row]))[0]!;
}

function shapeAdminProduct(row: Record<string, unknown>, lookups: ProductLookups) {
  const images = lookups.imagesByProduct.get(row.id as string) ?? [];
  const supplierName = row.supplier_id
    ? lookups.supplierNames.get(row.supplier_id as string)
    : undefined;
  const categorySlug =
    (row.category_id ? lookups.categorySlugs.get(row.category_id as string) : undefined) ?? '';

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sub: row.sub ?? '',
    category: categorySlug,
    categoryId: row.category_id,
    /** The master product this is a copy of (null = till-only, never sold online). */
    masterProductId: row.master_product_id ?? null,
    kind: row.kind,
    price: row.price,
    // Admin sees the three-state status too (derived, same rule as the
    // storefront) plus the real numbers below — never the reverse.
    stockStatus: (row.stock_qty as number) > 0 ? 'in-stock' : 'out-of-stock',
    // Round 5 #17: real columns now (0054_product_badge_compat_buyin.sql) —
    // these used to be hardcoded null regardless of what the form submitted.
    tag: (row.tag as string | null) ?? null,
    compatibility: (row.compatibility as string | null) ?? null,
    description: row.description ?? '',
    highlights: [] as string[],
    specs: [] as { label: string; value: string }[],
    // BUG-01: filtered, not trusted raw — see filterValidImageUrls's own comment.
    images: filterValidImageUrls(images),
    art: artForCategory(categorySlug),
    tile: DEFAULT_TILE,
    // ---- StockMeta (admin-only) ----
    costPrice: row.cost_price,
    stockQty: row.stock_qty,
    supplier: supplierName ?? null,
    localBuying: row.supplier_id === null,
    // Round 5 #12: real column now — see buyInForms.ts. This is the raw
    // STORAGE PATH, not a display name — deliberately: the form round-trips
    // this value back on every save regardless of whether the file itself
    // changed (react-hook-form's defaultValue), so returning anything other
    // than the exact value that should be persisted unchanged would corrupt
    // it on the very next unrelated edit. The frontend derives a friendly
    // filename from it for display. The actual signed download URL is
    // minted on demand by GET /admin/products/:id/buy-in-form, never handed
    // out in this list response — a 60s signed URL sitting in a cached
    // admin list would already be stale by the time anyone clicked it.
    buyInForm: (row.buy_in_form_path as string | null) ?? null,
    barcode: row.barcode,
    // Item 11 — staff-only. Present on a handset bought in through the
    // trade-in flow, null on everything else. Never selected by any public
    // product response (CUSTOMER_PRODUCT_COLUMNS names its columns).
    imei: (row.imei as string | null) ?? null,
    lowStockAlert: row.low_stock_alert,
    lowStockThreshold: row.low_stock_threshold,
    isActive: row.is_active,
    inStoreOnly: row.in_store_only,
    // Round 5 Phase 4 #16. When true, price/stockQty/costPrice/barcode
    // above are frozen and unused — see GET /admin/products/:id/variants.
    hasVariants: row.has_variants ?? false,
  };
}

/** Round 5 Phase 4 #16. Same flat shape as toAdminProduct's own admin-only fields. */
export function toAdminVariant(row: Record<string, unknown>) {
  return {
    id: row.id,
    productId: row.product_id,
    options: row.options,
    sku: row.sku,
    barcode: row.barcode,
    priceAdjustment: row.price_adjustment,
    costPrice: row.cost_price,
    stockQty: row.stock_qty,
    lowStockAlert: row.low_stock_alert,
    lowStockThreshold: row.low_stock_threshold,
    isActive: row.is_active,
  };
}

/** Free-text supplier NAME -> real suppliers.id, creating the row on first use. */
async function resolveSupplierId(name: string | undefined): Promise<string | null> {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  const existing = await db
    .selectFrom('suppliers')
    .select('id')
    .where('name', 'ilike', trimmed)
    .executeTakeFirst();
  if (existing) return existing.id;
  const created = await db
    .insertInto('suppliers')
    .values({ name: trimmed })
    .returning('id')
    .executeTakeFirstOrThrow();
  return created.id;
}

/**
 * A barcode that's already taken, told as a person would say it.
 *
 * Barcodes are unique across products (0003) and across variants (0060), so
 * scanning a box that's already on the shelf trips a unique index. Passed
 * through, that reached staff as 'duplicate key value violates unique
 * constraint "products_barcode_unique_idx"' — true, and useless at a
 * counter. Returns null for any other error, so callers fall through to
 * their existing handling.
 */
export async function barcodeTakenMessage(
  error: Pick<DbError, 'code' | 'message'>,
  barcode: string | null | undefined,
  shopId: string,
): Promise<string | null> {
  if (error.code !== '23505' || !/barcode/i.test(error.message) || !barcode) return null;
  const owner = await db
    .selectFrom('products')
    .select('name')
    .where('barcode', '=', barcode)
    .where('shop_id', '=', shopId)
    .executeTakeFirst();
  const where = owner?.name ? `on ${owner.name}` : 'on another product or variant';
  return `That barcode (${barcode}) is already ${where}. Scan the right one, or Generate a new one.`;
}

router.get('/products', requireStaff, requirePermission('inventory.manage'), async (req, res) => {
  const shopId = readShop(req);
  const data = await db
    .selectFrom('products')
    .selectAll()
    .$if(!!shopId, (qb) => qb.where('shop_id', '=', shopId!))
    .orderBy('name')
    .execute();
  return res.json(await toAdminProducts(data));
});

/**
 * Total stock and total inventory value (at cost, whole catalogue) — the
 * Inventory tab's own totals, item C (0079). A dedicated RPC rather than
 * something derived from the list above: product_variants carries its own
 * stock_qty/cost_price once has_variants is true, and this list never
 * fetches variant rows — inventory_summary() sees both tables and sums them
 * correctly, which nothing on the client can do with what /products already
 * returns.
 *
 * See the migration's own comment for the exact rule: cost basis, every unit
 * on hand counted (retired lines INCLUDED — retiring is a soft delete that
 * never touches stock_qty), in_store_only included, whole catalogue rather
 * than the active filter. The retired portion comes back separately so the
 * tab can show what the headline figure is made of.
 */
router.get(
  '/inventory/summary',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data, error } = await attempt(() =>
      rpc<
        {
          total_stock: number;
          total_value_pence: number;
          retired_stock: number;
          retired_value_pence: number;
        }[]
      >('inventory_summary', { p_shop_id: readShop(req) }, { returnsSet: true }),
    );
    const row = data?.[0];
    if (error || !row) return res.status(500).json({ error: 'Could not load inventory totals.' });
    return res.json({
      totalStock: row.total_stock,
      totalValuePence: row.total_value_pence,
      retiredStock: row.retired_stock,
      retiredValuePence: row.retired_value_pence,
    });
  },
);

/**
 * Real product-photo upload (BUG-01 follow-up). Independent of any product
 * id on purpose — the dialog lets staff add photos while the rest of the
 * form is still being filled in, before the product row exists at all.
 * Returns a real, public Storage URL;
 * the caller adds it to the form's own `images` array and it only reaches
 * `product_images` when the product itself is created/saved — still
 * passing through productInputBodySchema's `.url()` validation exactly as
 * before, this route doesn't bypass it.
 *
 * `uploadProductImageMiddleware` runs first: rejects a non-image
 * content-type and enforces the size cap before the handler below ever
 * sees the request. A multer error (bad type, too large) reaches the error
 * middleware as a plain thrown Error, which the app-level handler
 * (server.ts) turns into a generic 500 — status-mapped to something more
 * specific here so the form can tell staff exactly what went wrong.
 *
 * Registered here, ahead of `/products/:id`, deliberately — Express matches
 * routes in registration order, and `:id` happily swallows the literal
 * string "images" if it comes first. It briefly did exactly that (routed
 * into the deactivate-a-product handler, which then failed trying to parse
 * "images" as a product uuid) before this got moved up.
 */
router.post(
  '/products/images',
  requireStaff,
  requirePermission('inventory.manage'),
  (req, res, next) => {
    uploadProductImageMiddleware(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : 'Upload failed.';
        const tooLarge = message.includes('File too large');
        return res
          .status(400)
          .json({ error: tooLarge ? 'That image is larger than 8MB.' : message });
      }
      next();
    });
  },
  async (req, res) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json({ error: 'No image was received.' });

    try {
      const { url } = await uploadProductImage(file.buffer, file.mimetype);
      return res.status(201).json({ url });
    } catch (err) {
      // Round 3 #5.1: a still-oversized image is a real, expected 400 (the
      // crop tool should have caught it client-side) — everything else
      // (a corrupt file, Storage down) is the genuine 500 it always was.
      if (err instanceof ImageTooLargeError) {
        return res.status(400).json({ error: err.message });
      }
      // Generic 500 — a corrupt file or Storage being down, not something
      // to hand the client the raw message for. Full detail to the log.
      // eslint-disable-next-line no-console
      console.error('[api] product image upload failed:', err);
      return res.status(500).json({ error: 'Could not upload the image.' });
    }
  },
);

/**
 * Removes an uploaded photo that never ended up attached to a saved product
 * (BUG-15 hardening) — a fresh upload the dialog decided to drop before
 * saving, or the whole dialog cancelled outright. `url` rather than a
 * product/photo id because there is no product row yet in the create-mode
 * case this exists for. Best-effort: a failure here is reported but the
 * caller isn't blocked on it — the worst case is the pre-existing behaviour
 * (an orphaned file), not a new one. Same registration-order note as the
 * upload route above applies here too.
 */
router.delete(
  '/products/images',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url : null;
    if (!url) return res.status(400).json({ error: 'No image URL was given.' });

    // Independent audit finding MED-04. This route exists only to clean up
    // an image uploaded during a create/edit that was then abandoned — one
    // that is by definition attached to nothing. The dialog already only
    // ever sends those (it tracks this session's own uploads and sends
    // nothing else), but that invariant lived entirely in the client: the
    // endpoint itself would delete ANY url it was handed, including a photo
    // currently on the storefront. Checking it here makes the rule the
    // server's rather than the caller's.
    //
    // Cannot block the legitimate path: a photo the dialog is cleaning up
    // has never been saved, so it has no product_images row to find.
    const { data: referencing, error: refErr } = await attempt(() =>
      db.selectFrom('product_images').select('id').where('url', '=', url).limit(1).execute(),
    );
    if (refErr) return res.status(500).json({ error: 'Could not check the image.' });
    if (referencing.length > 0) {
      return res
        .status(409)
        .json({ error: 'That image is still attached to a product — remove it there first.' });
    }

    try {
      await deleteProductImage(url);
      return res.status(204).end();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[api] product image delete failed:', err);
      return res.status(500).json({ error: 'Could not remove the image.' });
    }
  },
);

/**
 * Round 5 #12: real signed buy-in form upload. Same shape as the product-
 * photo upload just above (independent of any product id, multer memory
 * storage, middleware runs first to reject a bad type/oversized file before
 * the handler sees the request) — registered ahead of `/products/:id` for
 * the identical reason documented on that route: Express matches in
 * registration order, and `:id` would otherwise swallow the literal string
 * "buy-in-form".
 */
router.post(
  '/products/buy-in-form',
  requireStaff,
  requirePermission('inventory.manage'),
  (req, res, next) => {
    uploadBuyInFormMiddleware(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : 'Upload failed.';
        const tooLarge = message.includes('File too large');
        return res
          .status(400)
          .json({ error: tooLarge ? 'That file is larger than 8MB.' : message });
      }
      next();
    });
  },
  async (req, res) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json({ error: 'No file was received.' });
    try {
      const { path } = await uploadBuyInForm(file.buffer, file.mimetype, file.originalname);
      return res.status(201).json({ path });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[api] buy-in form upload failed:', err);
      return res.status(500).json({ error: 'Could not upload the form.' });
    }
  },
);

/**
 * Round 5 #12: a signed, 60-second download link for a product's buy-in
 * form — minted on demand, never handed out in the admin product list
 * (see toAdminProduct's own comment on why). `buy-in-forms` has no
 * public-read policy, so this is the only way to ever actually read one
 * back.
 */
router.get(
  '/products/:id/buy-in-form',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const row = await productForRequest(req, req.params.id);
    if (!row) return res.status(404).json({ error: 'Product not found.' });
    const path = row.buy_in_form_path;
    if (!path)
      return res.status(404).json({ error: 'No buy-in form is on file for this product.' });

    const signedUrl = await signBuyInFormUrl(path);
    if (!signedUrl) return res.status(500).json({ error: 'Could not generate a download link.' });
    return res.json({ signedUrl, filename: buyInFormDisplayName(path) });
  },
);

router.post('/products', requireStaff, requirePermission('inventory.manage'), async (req, res) => {
  const parsed = productInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;
  // Creating stock needs a shop: the cashier's own, or the one an owner names.
  const shopId = await writeShop(req, res);
  if (!shopId) return;

  const supplierId = body.localBuying
    ? null
    : await resolveSupplierId(body.supplier).catch(() => null);
  const slug = body.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const { data: row, error } = await attempt(() =>
    db
      .insertInto('products')
      .values({
        slug: `${slug}-${Date.now().toString(36)}`,
        shop_id: shopId,
        name: body.name,
        sub: body.sub,
        description: body.description,
        category_id: body.categoryId,
        // kind is deliberately NOT set here (client decision #14) —
        // products_derive_kind (0064) computes it from category_id on
        // insert, every time, unconditionally.
        price: body.price,
        cost_price: body.costPrice,
        stock_qty: 0, // stock only ever moves through stock_receive/stock_consume below — never set directly on create
        barcode: body.barcode || null,
        // Item 11 — `!== undefined` rather than `|| null`, deliberately:
        // null must reach the column to CLEAR a wrongly-set IMEI, and the
        // field being absent must leave whatever is there alone. Only ever
        // populated on a handset bought in through the trade-in flow.
        ...(body.imei !== undefined ? { imei: body.imei || null } : {}),
        supplier_id: supplierId,
        low_stock_alert: body.lowStockAlert,
        low_stock_threshold: body.lowStockThreshold,
        in_store_only: body.inStoreOnly,
        // Round 5 #17/#12: previously accepted by the schema and dropped —
        // real columns now (0054_product_badge_compat_buyin.sql).
        tag: body.tag || null,
        compatibility: body.compatibility || null,
        buy_in_form_path: body.buyInForm || null,
        has_variants: body.hasVariants,
      })
      .returning('id')
      .executeTakeFirstOrThrow(),
  );
  if (error) {
    const taken = await barcodeTakenMessage(error, body.barcode, shopId);
    return res.status(taken ? 409 : 400).json({ error: taken ?? error.message });
  }

  // Round 5 Phase 4 #16: once has_variants is true, this product's own
  // stock_qty is frozen and unused (0060) — a variant product's stock
  // only ever moves through the variant CRUD block below, never here.
  // Best-effort, as it always has been: the product exists either way.
  if (!body.hasVariants && body.stockQty > 0) {
    await rpc('stock_receive', {
      p_product_id: row.id,
      p_qty: body.stockQty,
      p_unit_cost: body.costPrice,
      p_kind: 'receipt',
      p_staff_id: req.user!.id,
    }).catch(() => undefined);
  }
  if (body.images?.length) {
    // BUG-01: this insert's error used to go completely unchecked — a bad
    // row (now impossible via this route, since productInputBodySchema
    // validates .url() first) could land silently with no record of it
    // anywhere. Logged now regardless, rather than assuming the schema is
    // the only path a bad value could ever take. Not failing the create
    // over it — the product itself already saved successfully, and losing
    // that over a photo row would be a worse outcome than a missing photo.
    const images = body.images;
    const { error: imagesError } = await attempt(() =>
      db
        .insertInto('product_images')
        .values(images.map((url, position) => ({ product_id: row.id, url, position })))
        .execute(),
    );
    if (imagesError) {
      console.error('[admin.routes] product_images insert failed', {
        productId: row.id,
        error: imagesError.message,
      });
    }
  }

  // Joined the master list on insert (0099); a till-only product is taken off it again.
  if (body.addToMaster === false) {
    await rpc('unlink_product_from_master', { p_product_id: row.id }).catch(() => undefined);
  }

  const fresh = await productById(row.id);
  return res.status(201).json(await toAdminProduct(fresh!));
});

/**
 * Client decision #15 (post-launch): the stock count field is unlocked —
 * an admin can type a total directly. Weighted-average cost is gone
 * (0063_remove_cost_averaging.sql); the currently-entered cost price
 * applies to the whole stock volume, full stop.
 *
 * Still routed through the stock ledger, not a bare column overwrite —
 * "keep stock_movements as a ledger" was explicit. An increase is recorded
 * as a 'receipt' (so stock_status_for's 30-day "restocking" window keeps
 * firing for exactly the case it's meant to: new stock genuinely arriving);
 * a decrease is a 'correction' (stock_movements_reason_required already
 * demands a reason for those, hence the fixed reason string below — there's
 * no free-text reason field on this form, and "count corrected from the
 * product edit screen" is an honest, specific one). Either way,
 * apply_stock_movement() (0063) sets cost_price directly from unit_cost on
 * the way through — no blending — which is what removes the averaging.
 *
 * cost_price is ALSO set directly, unconditionally, after the movement (or
 * with no movement at all, if the count didn't change) — a re-price with no
 * stock change is a real, supported edit now, not something that only
 * happens as a side effect of receiving stock.
 */
router.put(
  '/products/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = productInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const productId = req.params.id ?? '';
    const existing = await productForRequest(req, productId, true);
    if (!existing) return res.status(404).json({ error: 'Product not found.' });

    // Someone without costs.view cannot read the cost, so the form they edited carries a blank one:
    // it must never overwrite the real figure. Their edit leaves the cost exactly as it was.
    const costPrice = canSeeCosts(req) ? body.costPrice : existing.cost_price;

    const supplierId = body.localBuying
      ? null
      : await resolveSupplierId(body.supplier).catch(() => null);

    const { data: row, error } = await attempt(() =>
      db
        .updateTable('products')
        .set({
          name: body.name,
          sub: body.sub,
          description: body.description,
          category_id: body.categoryId,
          // kind is deliberately NOT set here either — see the identical
          // note on the POST handler above. products_derive_kind (0064)
          // recomputes it whenever category_id changes, including this
          // UPDATE.
          price: body.price,
          barcode: body.barcode || null,
          // Item 11 — `!== undefined` rather than `|| null`, deliberately:
          // null must reach the column to CLEAR a wrongly-set IMEI, and the
          // field being absent must leave whatever is there alone. Only ever
          // populated on a handset bought in through the trade-in flow.
          ...(body.imei !== undefined ? { imei: body.imei || null } : {}),
          supplier_id: supplierId,
          low_stock_alert: body.lowStockAlert,
          low_stock_threshold: body.lowStockThreshold,
          in_store_only: body.inStoreOnly,
          tag: body.tag || null,
          compatibility: body.compatibility || null,
          buy_in_form_path: body.buyInForm || null,
          has_variants: body.hasVariants,
        })
        .where('id', '=', productId)
        .returning('id')
        .executeTakeFirst(),
    );
    if (error) {
      const taken = await barcodeTakenMessage(error, body.barcode, existing.shop_id);
      return res.status(taken ? 409 : 400).json({ error: taken ?? error.message });
    }
    if (!row) return res.status(404).json({ error: 'Product not found.' });

    // Best-effort stock moves, as they always were: a failure here leaves the
    // count where it was, and the response shows the real figure.
    const delta = body.stockQty - existing.stock_qty;
    if (delta > 0) {
      await rpc('stock_receive', {
        p_product_id: productId,
        p_qty: delta,
        p_unit_cost: costPrice,
        p_kind: 'receipt',
        p_staff_id: req.user!.id,
      }).catch(() => undefined);
    } else if (delta < 0) {
      await rpc('stock_consume', {
        p_product_id: productId,
        p_qty: -delta,
        p_kind: 'correction',
        p_staff_id: req.user!.id,
        p_reason: 'Stock count corrected from the product edit screen',
      }).catch(() => undefined);
    }
    // Unconditional: whatever cost price is on the form wins, whether or
    // not the count also changed — see this route's own comment above.
    await db
      .updateTable('products')
      .set({ cost_price: costPrice })
      .where('id', '=', productId)
      .execute()
      .catch(() => undefined);

    // The "Add to Master List" box on edit. Absent = unchanged.
    if (body.addToMaster === true && !existing.master_product_id) {
      await rpc('create_master_for_product', { p_product_id: productId }).catch(() => undefined);
    } else if (body.addToMaster === false && existing.master_product_id) {
      await rpc('unlink_product_from_master', { p_product_id: productId }).catch(() => undefined);
    }

    const fresh = (await productById(productId))!;
    const masterSlug = existing.master_product_id
      ? (
          await db
            .selectFrom('master_products')
            .select('slug')
            .where('id', '=', existing.master_product_id)
            .executeTakeFirst()
        )?.slug
      : undefined;
    // The public page is the MASTER's slug.
    if (masterSlug) revalidateProductPage(masterSlug);
    // Client-reported bug: a category move landed in the DB immediately
    // (kind is DB-derived from category_id, 0064) but the product's own
    // detail page — fully static, no revalidate interval — kept showing
    // stale in-store-only messaging until the next full rebuild. See
    // lib/revalidate.ts for the full writeup. Unconditional: cheap,
    // idempotent, and simpler than tracking whether category_id specifically
    // changed among everything else this form can edit.
    revalidateProductPage(fresh.slug);
    return res.json(await toAdminProduct(fresh));
  },
);
