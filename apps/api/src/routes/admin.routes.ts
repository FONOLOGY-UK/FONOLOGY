import { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireStaff, requirePermission } from '../middleware/auth.js';
import { hashPin } from '../lib/password.js';
import { artForCategory, DEFAULT_TILE, filterValidImageUrls } from '../lib/productMapping.js';
import {
  uploadProductImageMiddleware,
  uploadProductImage,
  deleteProductImage,
  ImageTooLargeError,
} from '../lib/productImages.js';
import {
  uploadBuyInFormMiddleware,
  uploadBuyInForm,
  signBuyInFormUrl,
  buyInFormDisplayName,
} from '../lib/buyInForms.js';
import {
  productInputBodySchema,
  variantInputBodySchema,
  stockAdjustBodySchema,
  stockReceiveBodySchema,
  stockWriteOffBodySchema,
  categoryInputBodySchema,
  supplierInputBodySchema,
  promotionGroupBodySchema,
  staffCreateBodySchema,
  staffUpdateBodySchema,
  staffPermissionsBodySchema,
  staffPinResetBodySchema,
  settingsPatchBodySchema,
  labelTemplateBodySchema,
  reviewInputBodySchema,
  deviceInputBodySchema,
  repairTypeInputBodySchema,
} from '../schemas.js';

import { createRouter } from '../lib/router.js';

export const adminRouter = createRouter();

/* ---------------------------------------------------------------------- */
/* Products — full admin shape, including stock_qty and cost_price          */
/* ---------------------------------------------------------------------- */

async function toAdminProduct(row: Record<string, unknown>) {
  const [{ data: images }, { data: supplier }, { data: category }] = await Promise.all([
    supabaseAdmin
      .from('product_images')
      .select('url')
      .eq('product_id', row.id as string)
      .order('position'),
    row.supplier_id
      ? supabaseAdmin
          .from('suppliers')
          .select('name')
          .eq('id', row.supplier_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // category_id (FEATURE-05, migration 0045) is the source of truth now —
    // products.category is frozen and no longer read here. Resolved the same
    // way supplier_id -> name is resolved just above.
    row.category_id
      ? supabaseAdmin
          .from('categories')
          .select('slug, label')
          .eq('id', row.category_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const categorySlug = category?.slug ?? '';

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sub: row.sub ?? '',
    category: categorySlug,
    categoryId: row.category_id,
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
    images: filterValidImageUrls((images ?? []).map((i) => i.url as string)),
    art: artForCategory(categorySlug),
    tile: DEFAULT_TILE,
    // ---- StockMeta (admin-only) ----
    costPrice: row.cost_price,
    stockQty: row.stock_qty,
    supplier: supplier?.name ?? null,
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
function toAdminVariant(row: Record<string, unknown>) {
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

/** Free-text supplier NAME (matches the mock) -> real suppliers.id, creating the row on first use. */
async function resolveSupplierId(name: string | undefined): Promise<string | null> {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  const { data: existing } = await supabaseAdmin
    .from('suppliers')
    .select('id')
    .ilike('name', trimmed)
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data: created, error } = await supabaseAdmin
    .from('suppliers')
    .insert({ name: trimmed })
    .select('id')
    .single();
  if (error) throw error;
  return created.id as string;
}

adminRouter.get(
  '/products',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    const { data } = await supabaseAdmin.from('products').select('*').order('name');
    return res.json(await Promise.all((data ?? []).map(toAdminProduct)));
  },
);

/**
 * Real product-photo upload (BUG-01 follow-up). Independent of any product
 * id on purpose — the dialog lets staff add photos while the rest of the
 * form is still being filled in, before the product row exists at all, same
 * as the mock version this replaces. Returns a real, public Storage URL;
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
adminRouter.post(
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
adminRouter.delete(
  '/products/images',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url : null;
    if (!url) return res.status(400).json({ error: 'No image URL was given.' });
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
adminRouter.post(
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
adminRouter.get(
  '/products/:id/buy-in-form',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: row } = await supabaseAdmin
      .from('products')
      .select('buy_in_form_path')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!row) return res.status(404).json({ error: 'Product not found.' });
    const path = row.buy_in_form_path as string | null;
    if (!path)
      return res.status(404).json({ error: 'No buy-in form is on file for this product.' });

    const signedUrl = await signBuyInFormUrl(path);
    if (!signedUrl) return res.status(500).json({ error: 'Could not generate a download link.' });
    return res.json({ signedUrl, filename: buyInFormDisplayName(path) });
  },
);

adminRouter.post(
  '/products',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = productInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const supplierId = body.localBuying
      ? null
      : await resolveSupplierId(body.supplier).catch(() => null);
    const slug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const { data: row, error } = await supabaseAdmin
      .from('products')
      .insert({
        slug: `${slug}-${Date.now().toString(36)}`,
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
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });

    // Round 5 Phase 4 #16: once has_variants is true, this product's own
    // stock_qty is frozen and unused (0060) — a variant product's stock
    // only ever moves through the variant CRUD block below, never here.
    if (!body.hasVariants && body.stockQty > 0) {
      await supabaseAdmin.rpc('stock_receive', {
        p_product_id: row.id,
        p_qty: body.stockQty,
        p_unit_cost: body.costPrice,
        p_kind: 'receipt',
        p_staff_id: req.user!.id,
      });
    }
    if (body.images?.length) {
      // BUG-01: this insert's error used to go completely unchecked — a bad
      // row (now impossible via this route, since productInputBodySchema
      // validates .url() first) could land silently with no record of it
      // anywhere. Logged now regardless, rather than assuming the schema is
      // the only path a bad value could ever take. Not failing the create
      // over it — the product itself already saved successfully, and losing
      // that over a photo row would be a worse outcome than a missing photo.
      const { error: imagesError } = await supabaseAdmin
        .from('product_images')
        .insert(body.images.map((url, position) => ({ product_id: row.id, url, position })));
      if (imagesError) {
        console.error('[admin.routes] product_images insert failed', {
          productId: row.id,
          error: imagesError.message,
        });
      }
    }

    const { data: fresh } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', row.id)
      .single();
    return res.status(201).json(await toAdminProduct(fresh));
  },
);

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
adminRouter.put(
  '/products/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = productInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: existing } = await supabaseAdmin
      .from('products')
      .select('stock_qty')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Product not found.' });

    const supplierId = body.localBuying
      ? null
      : await resolveSupplierId(body.supplier).catch(() => null);

    const { data: row, error } = await supabaseAdmin
      .from('products')
      .update({
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
        supplier_id: supplierId,
        low_stock_alert: body.lowStockAlert,
        low_stock_threshold: body.lowStockThreshold,
        in_store_only: body.inStoreOnly,
        tag: body.tag || null,
        compatibility: body.compatibility || null,
        buy_in_form_path: body.buyInForm || null,
        has_variants: body.hasVariants,
      })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Product not found.' });

    const delta = body.stockQty - (existing.stock_qty as number);
    if (delta > 0) {
      await supabaseAdmin.rpc('stock_receive', {
        p_product_id: req.params.id,
        p_qty: delta,
        p_unit_cost: body.costPrice,
        p_kind: 'receipt',
        p_staff_id: req.user!.id,
      });
    } else if (delta < 0) {
      await supabaseAdmin.rpc('stock_consume', {
        p_product_id: req.params.id,
        p_qty: -delta,
        p_kind: 'correction',
        p_staff_id: req.user!.id,
        p_reason: 'Stock count corrected from the product edit screen',
      });
    }
    // Unconditional: whatever cost price is on the form wins, whether or
    // not the count also changed — see this route's own comment above.
    await supabaseAdmin
      .from('products')
      .update({ cost_price: body.costPrice })
      .eq('id', req.params.id);

    const { data: fresh } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    return res.json(await toAdminProduct(fresh));
  },
);

/* ---------------------------------------------------------------------- */
/* Product variants (Round 5 Phase 4 #16, trimmed v1)                       */
/* ---------------------------------------------------------------------- */
// Same shape as the devices/repair-types blocks above: gated on
// inventory.manage, list/create/update/soft-delete. Nested under the
// product because a variant has no independent existence — unlike devices
// or repair types, it can never be listed or edited without its parent in
// view. stock_qty/costPrice move ONLY through stock_receive/stock_consume
// (the variant-aware branch added in 0060), never a plain UPDATE — same
// discipline the parent product already has for its own stock/cost.

adminRouter.get(
  '/products/:id/variants',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from('product_variants')
      .select('*')
      .eq('product_id', req.params.id)
      .order('created_at');
    if (error) return res.status(500).json({ error: 'Could not load variants.' });
    return res.json((data ?? []).map(toAdminVariant));
  },
);

adminRouter.post(
  '/products/:id/variants',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = variantInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    // product_variants_require_flag (0060) would reject this anyway, but a
    // 400 with a readable message beats a raw trigger exception surfacing
    // in the admin UI.
    const { data: product } = await supabaseAdmin
      .from('products')
      .select('has_variants')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    if (!product.has_variants) {
      return res
        .status(400)
        .json({ error: 'Turn on variants for this product before adding one.' });
    }

    // stock_qty is never set directly on create here either — same rule as
    // a plain product (see POST /products above). A variant is created at
    // zero stock and stocked up through the receive endpoint below.
    const { data: row, error } = await supabaseAdmin
      .from('product_variants')
      .insert({
        product_id: req.params.id,
        options: body.options,
        sku: body.sku,
        barcode: body.barcode || null,
        price_adjustment: body.priceAdjustment,
        cost_price: 0,
        stock_qty: 0,
        low_stock_alert: body.lowStockAlert,
        low_stock_threshold: body.lowStockThreshold,
        is_active: body.isActive,
      })
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });

    if (body.stockQty > 0) {
      await supabaseAdmin.rpc('stock_receive', {
        p_product_id: req.params.id,
        p_qty: body.stockQty,
        p_unit_cost: body.costPrice,
        p_kind: 'receipt',
        p_staff_id: req.user!.id,
        p_variant_id: row.id,
      });
    }

    const { data: fresh } = await supabaseAdmin
      .from('product_variants')
      .select('*')
      .eq('id', row.id)
      .single();
    return res.status(201).json(toAdminVariant(fresh));
  },
);

/** Client decision #15 (post-launch): same unlock as the parent product's
 * own PUT handler above, applied to a variant's stock/cost — see that
 * route's comment for the full reasoning. */
adminRouter.put(
  '/products/:id/variants/:variantId',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = variantInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: existing } = await supabaseAdmin
      .from('product_variants')
      .select('stock_qty')
      .eq('id', req.params.variantId)
      .eq('product_id', req.params.id)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Variant not found.' });

    const { data: row, error } = await supabaseAdmin
      .from('product_variants')
      .update({
        options: body.options,
        sku: body.sku,
        barcode: body.barcode || null,
        price_adjustment: body.priceAdjustment,
        low_stock_alert: body.lowStockAlert,
        low_stock_threshold: body.lowStockThreshold,
        is_active: body.isActive,
      })
      .eq('id', req.params.variantId)
      .eq('product_id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Variant not found.' });

    const delta = body.stockQty - (existing.stock_qty as number);
    if (delta > 0) {
      await supabaseAdmin.rpc('stock_receive', {
        p_product_id: req.params.id,
        p_qty: delta,
        p_unit_cost: body.costPrice,
        p_kind: 'receipt',
        p_staff_id: req.user!.id,
        p_variant_id: req.params.variantId,
      });
    } else if (delta < 0) {
      await supabaseAdmin.rpc('stock_consume', {
        p_product_id: req.params.id,
        p_qty: -delta,
        p_kind: 'correction',
        p_staff_id: req.user!.id,
        p_reason: 'Stock count corrected from the product edit screen',
        p_variant_id: req.params.variantId,
      });
    }
    await supabaseAdmin
      .from('product_variants')
      .update({ cost_price: body.costPrice })
      .eq('id', req.params.variantId);

    const { data: fresh } = await supabaseAdmin
      .from('product_variants')
      .select('*')
      .eq('id', req.params.variantId)
      .single();
    return res.json(toAdminVariant(fresh));
  },
);

adminRouter.delete(
  '/products/:id/variants/:variantId',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    // Soft-delete, same as a product (stock_movements is ON DELETE RESTRICT
    // regardless — a variant with real sale/order history could never be
    // hard-deleted anyway).
    const { data: row, error } = await supabaseAdmin
      .from('product_variants')
      .update({ is_active: false })
      .eq('id', req.params.variantId)
      .eq('product_id', req.params.id)
      .select('id')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Variant not found.' });
    return res.status(204).end();
  },
);

/**
 * Adjust a variant's stock — same three operations as a plain product
 * (stockAdjustBodySchema/stockReceiveBodySchema/stockWriteOffBodySchema,
 * reused as-is). See the matching /products/:id/stock|receive|write-off
 * routes below for the product-level equivalents this mirrors.
 */
adminRouter.post(
  '/products/:id/variants/:variantId/stock',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = stockAdjustBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const delta = parsed.data.delta;
    if (delta === 0) return res.status(400).json({ error: 'Nothing to adjust.' });

    const rpcName = delta > 0 ? 'stock_receive' : 'stock_consume';
    const params =
      delta > 0
        ? {
            p_product_id: req.params.id,
            p_qty: delta,
            p_unit_cost: null,
            p_kind: 'correction',
            p_staff_id: req.user!.id,
            p_reason: 'Manual stocktake adjustment',
            p_variant_id: req.params.variantId,
          }
        : {
            p_product_id: req.params.id,
            p_qty: -delta,
            p_kind: 'correction',
            p_staff_id: req.user!.id,
            p_reason: 'Manual stocktake adjustment',
            p_variant_id: req.params.variantId,
          };
    const { error } = await supabaseAdmin.rpc(rpcName, params);
    if (error) return res.status(400).json({ error: error.message });

    const { data: row } = await supabaseAdmin
      .from('product_variants')
      .select('*')
      .eq('id', req.params.variantId)
      .single();
    return res.json(toAdminVariant(row));
  },
);

adminRouter.post(
  '/products/:id/variants/:variantId/receive',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = stockReceiveBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { error } = await supabaseAdmin.rpc('stock_receive', {
      p_product_id: req.params.id,
      p_qty: body.quantity,
      p_unit_cost: body.unitCost,
      p_kind: 'receipt',
      p_staff_id: req.user!.id,
      p_variant_id: req.params.variantId,
    });
    if (error) return res.status(400).json({ error: error.message });

    const { data: row } = await supabaseAdmin
      .from('product_variants')
      .select('*')
      .eq('id', req.params.variantId)
      .single();
    return res.json(toAdminVariant(row));
  },
);

adminRouter.post(
  '/products/:id/variants/:variantId/write-off',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = stockWriteOffBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { error } = await supabaseAdmin.rpc('stock_consume', {
      p_product_id: req.params.id,
      p_qty: body.quantity,
      p_kind: 'write_off',
      p_staff_id: req.user!.id,
      p_reason: body.reason,
      p_variant_id: req.params.variantId,
    });
    if (error) return res.status(400).json({ error: error.message });

    const { data: row } = await supabaseAdmin
      .from('product_variants')
      .select('*')
      .eq('id', req.params.variantId)
      .single();
    return res.json(toAdminVariant(row));
  },
);

/**
 * "delete" — DEACTIVATES, never hard-deletes. The mock's deleteProduct
 * actually splices the row; that's a demo convenience this app must not
 * copy — a product with real sale/order history cannot be deleted at all
 * (stock_movements is ON DELETE RESTRICT), and even one with none shouldn't
 * silently vanish from an owner-managed catalogue. See the B6 report.
 */
adminRouter.delete(
  '/products/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: row, error } = await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Product not found.' });
    return res.status(204).end();
  },
);

/**
 * Round 4 #BUG-10: the other half of "delete". Before this, nothing
 * anywhere ever set `is_active` back to true — PUT /products/:id doesn't
 * touch it (see the comment on that handler), and DELETE is idempotent, so
 * clicking it again on an already-retired product is a no-op, not an
 * undo. A dedicated endpoint, mirroring DELETE's own shape, rather than
 * folding `isActive` into the general edit schema — restoring is a
 * deliberate, singular action, not a field a staff member should be able to
 * flip while editing something else.
 */
adminRouter.post(
  '/products/:id/restore',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: row, error } = await supabaseAdmin
      .from('products')
      .update({ is_active: true })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Product not found.' });
    return res.json(await toAdminProduct(row));
  },
);

/** Quick +/- adjustment from the inventory table — maps to a 'correction' movement, the one kind the schema leaves unsigned. */
adminRouter.post(
  '/products/:id/stock',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = stockAdjustBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const delta = parsed.data.delta;
    if (delta === 0) return res.status(400).json({ error: 'Adjustment cannot be zero.' });

    const rpc =
      delta > 0
        ? supabaseAdmin.rpc('stock_receive', {
            p_product_id: req.params.id,
            p_qty: delta,
            p_unit_cost: null,
            p_kind: 'correction',
            p_reason: 'Quick adjustment from the inventory table',
            p_staff_id: req.user!.id,
          })
        : supabaseAdmin.rpc('stock_consume', {
            p_product_id: req.params.id,
            p_qty: -delta,
            p_kind: 'correction',
            p_reason: 'Quick adjustment from the inventory table',
            p_staff_id: req.user!.id,
          });
    const { error } = await rpc;
    if (error) return res.status(409).json({ error: error.message });

    const { data: row } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    return res.json(await toAdminProduct(row));
  },
);

/** Real stock receipt — updates the weighted-average cost via the schema's own trigger. */
adminRouter.post(
  '/products/:id/receive',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = stockReceiveBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { error } = await supabaseAdmin.rpc('stock_receive', {
      p_product_id: req.params.id,
      p_qty: parsed.data.quantity,
      p_unit_cost: parsed.data.unitCost,
      p_kind: 'receipt',
      p_staff_id: req.user!.id,
    });
    if (error) return res.status(409).json({ error: error.message });

    const { data: row } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    return res.json(await toAdminProduct(row));
  },
);

adminRouter.post(
  '/products/:id/write-off',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = stockWriteOffBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { error } = await supabaseAdmin.rpc('stock_consume', {
      p_product_id: req.params.id,
      p_qty: parsed.data.quantity,
      p_kind: 'write_off',
      p_reason: parsed.data.reason,
      p_staff_id: req.user!.id,
    });
    if (error) return res.status(409).json({ error: error.message });

    const { data: row } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    return res.json(await toAdminProduct(row));
  },
);

/**
 * Round 5 Phase 4 #16: a variant's barcode uniquely resolves to that exact
 * variant, checked first — a scan should never need a picker. Falls back
 * to the plain product barcode exactly as before. The response is still
 * `toAdminProduct(product)` either way (the till already knows how to add
 * a plain product); a variant match adds a `matchedVariant` field on top
 * carrying that variant's own effective price/stock/sku, which is what the
 * till uses to add THAT variant to the ticket rather than the parent.
 */
adminRouter.get(
  '/products/barcode/:code',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: variantRow } = await supabaseAdmin
      .from('product_variants')
      .select('*')
      .eq('barcode', req.params.code)
      .eq('is_active', true)
      .maybeSingle();

    if (variantRow) {
      const { data: product } = await supabaseAdmin
        .from('products')
        .select('*')
        .eq('id', variantRow.product_id as string)
        .maybeSingle();
      if (!product) return res.json(null);
      return res.json({
        ...(await toAdminProduct(product)),
        matchedVariant: toAdminVariant(variantRow),
      });
    }

    const { data: row } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('barcode', req.params.code)
      .maybeSingle();
    if (!row) return res.json(null);
    return res.json(await toAdminProduct(row));
  },
);

adminRouter.get(
  '/products/low-stock',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    const { data } = await supabaseAdmin.from('low_stock_products').select('*');
    return res.json(
      (data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        stockQty: r.stock_qty,
        lowStockThreshold: r.low_stock_threshold,
      })),
    );
  },
);

/* ---------------------------------------------------------------------- */
/* Categories — real CRUD, unlike products/suppliers (FEATURE-05, 0045)     */
/* ---------------------------------------------------------------------- */

function toApiCategory(row: Record<string, unknown>) {
  return {
    id: row.id,
    label: row.label,
    slug: row.slug,
    parentId: row.parent_id,
    // Client decision #14 (post-launch): Vape/Number Plates/Mobiles. Lets
    // the admin UI grey out rename/delete before the request even reaches
    // the server-side trigger that actually enforces it.
    isProtected: row.is_protected,
    createdAt: row.created_at,
  };
}

adminRouter.get(
  '/categories',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    const { data, error } = await supabaseAdmin.from('categories').select('*').order('label');
    if (error) return res.status(500).json({ error: 'Could not load categories.' });
    return res.json((data ?? []).map(toApiCategory));
  },
);

adminRouter.post(
  '/categories',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = categoryInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    // Same slugify as a product's own slug in POST /products just above —
    // deliberately never caller-supplied.
    const slug = body.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const { data: row, error } = await supabaseAdmin
      .from('categories')
      .insert({ label: body.label, slug, parent_id: body.parentId ?? null })
      .select('*')
      .single();
    if (error) {
      // categories.slug is UNIQUE — two labels that slugify the same
      // ("Vaping" / "vaping!") collide here, told honestly rather than as a
      // generic 400.
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A category with this name already exists.' });
      }
      return res.status(400).json({ error: error.message });
    }
    return res.status(201).json(toApiCategory(row));
  },
);

adminRouter.put(
  '/categories/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = categoryInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    // slug is deliberately never touched here — see categoryInputBodySchema's
    // comment. Only the display label and the parent can change.
    const patch: Record<string, unknown> = { label: body.label };
    if (body.parentId !== undefined) patch.parent_id = body.parentId;

    const { data: row, error } = await supabaseAdmin
      .from('categories')
      .update(patch)
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Category not found.' });
    return res.json(toApiCategory(row));
  },
);

/**
 * Real delete, unlike products/suppliers above — categories.id has no
 * history to preserve the way a sold product or a fulfilled order does.
 * ON DELETE RESTRICT (0045) on both products.category_id and
 * categories.parent_id means this simply fails, honestly, while anything
 * still depends on the category — never a silent cascade.
 */
adminRouter.delete(
  '/categories/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { error, count } = await supabaseAdmin
      .from('categories')
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) {
      if (error.code === '23503') {
        return res.status(409).json({
          error: 'This category still has products or subcategories under it — move them first.',
        });
      }
      return res.status(400).json({ error: error.message });
    }
    if (!count) return res.status(404).json({ error: 'Category not found.' });
    return res.status(204).end();
  },
);

/* ---------------------------------------------------------------------- */
/* Suppliers — CRUD, deactivate not delete                                  */
/* ---------------------------------------------------------------------- */

function toApiSupplier(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

adminRouter.get(
  '/suppliers',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    const { data } = await supabaseAdmin.from('suppliers').select('*').order('name');
    return res.json((data ?? []).map(toApiSupplier));
  },
);

adminRouter.post(
  '/suppliers',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = supplierInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    const { data: row, error } = await supabaseAdmin
      .from('suppliers')
      .insert({
        name: body.name,
        contact: body.contact ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        notes: body.notes ?? null,
      })
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json(toApiSupplier(row));
  },
);

adminRouter.put(
  '/suppliers/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = supplierInputBodySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.contact !== undefined) patch.contact = body.contact;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.email !== undefined) patch.email = body.email;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.isActive !== undefined) patch.is_active = body.isActive;

    const { data: row, error } = await supabaseAdmin
      .from('suppliers')
      .update(patch)
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Supplier not found.' });
    return res.json(toApiSupplier(row));
  },
);

/** Deactivate — never delete (products may reference this supplier). */
adminRouter.delete(
  '/suppliers/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: row, error } = await supabaseAdmin
      .from('suppliers')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Supplier not found.' });
    return res.status(204).end();
  },
);

/* ---------------------------------------------------------------------- */
/* Promotions — till-only, same-product bulk tiers                          */
/* ---------------------------------------------------------------------- */

/**
 * Every promotion, with its tiers — in TWO queries total, not two per row.
 *
 * Same fix as `listApiPromotionGroups()` below, applied to this flat
 * endpoint: the per-row version fetched `promo_tiers` once per promotion, so
 * a shop with N active promotions issued N+1 queries for one till page load.
 * Fetch every row's tiers in a single `.in(...)` and group them in memory
 * instead — one definition of "batch these" duplicated on purpose (a shared
 * helper here would need to reconcile this function's flat one-row-per-
 * promotion shape with that one's grouped-by-group_id shape, which is more
 * indirection than the four lines below are worth).
 */
async function toApiPromotions(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return [];
  const { data: tierRows } = await supabaseAdmin
    .from('promo_tiers')
    .select('promotion_id, min_qty, unit_price')
    .in(
      'promotion_id',
      rows.map((r) => r.id as string),
    )
    .order('min_qty');

  const tiersByPromotion = new Map<string, { minQty: number; unitPrice: number }[]>();
  for (const t of tierRows ?? []) {
    const key = t.promotion_id as string;
    const list = tiersByPromotion.get(key) ?? [];
    list.push({ minQty: t.min_qty as number, unitPrice: t.unit_price as number });
    tiersByPromotion.set(key, list);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.label ?? '',
    productIds: [row.product_id], // schema: one promotion row is scoped to one product; see the B6 report
    tiers: tiersByPromotion.get(row.id as string) ?? [],
    active: row.is_active,
    createdAt: row.created_at,
  }));
}

/**
 * Gated on `pos.operate`, deliberately NOT `promotions.manage` — this route's
 * own section header says it: promotions are till-only, so every till
 * operator needs to read the current tiers to price a sale correctly, not
 * just whoever can create/edit them. `promotions.manage` still gates every
 * write (POST /promotions/bulk, the group routes below) — an employee can
 * see prices, not set them.
 *
 * Root cause of the "till doesn't apply promotions" report: this route used
 * to require `promotions.manage`, which the DB's default_permissions() (see
 * 0002_identity.sql) only grants to the owner role. Every non-owner till
 * operator got a 403 from usePromotions(), so `priceFor()` in pos-view.tsx
 * never saw a tier to apply — not a pricing bug, an authorization one.
 */
adminRouter.get(
  '/promotions',
  requireStaff,
  requirePermission('pos.operate'),
  async (_req, res) => {
    const { data } = await supabaseAdmin
      .from('promotions')
      .select('*')
      .order('created_at', { ascending: false });
    return res.json(await toApiPromotions(data ?? []));
  },
);

/**
 * Every promotion, grouped — the admin screen's list.
 *
 * The flat GET above stays because the till needs it: one row per product is
 * exactly the shape a per-product price lookup wants. This one answers the
 * other question ("what offers has the shop set up?"), where a range covering
 * six products is one offer, not six.
 *
 * Two queries total, not two per group: the rows come back in one pass and the
 * tiers for every group head in a second.
 */
async function listApiPromotionGroups() {
  const { data: rows } = await supabaseAdmin
    .from('promotions')
    .select('id, group_id, product_id, label, is_active, starts_at, ends_at, created_at')
    .order('created_at', { ascending: false });

  // Preserve first-seen order (created_at desc) while collecting each group.
  const groups = new Map<string, typeof rows>();
  for (const row of rows ?? []) {
    const key = row.group_id as string;
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  // Every row in a group carries the same label/active/window, so one row per
  // group answers for it — and only that row's tiers need reading.
  const heads = [...groups.values()].map((g) => g![0]!);
  const { data: tierRows } = await supabaseAdmin
    .from('promo_tiers')
    .select('promotion_id, min_qty, unit_price')
    .in(
      'promotion_id',
      heads.map((h) => h.id as string),
    )
    .order('min_qty');

  const tiersByPromotion = new Map<string, { minQty: number; unitPrice: number }[]>();
  for (const t of tierRows ?? []) {
    const key = t.promotion_id as string;
    const list = tiersByPromotion.get(key) ?? [];
    list.push({ minQty: t.min_qty as number, unitPrice: t.unit_price as number });
    tiersByPromotion.set(key, list);
  }

  return heads.map((head) => {
    const rowsInGroup = groups.get(head.group_id as string)!;
    return {
      groupId: head.group_id,
      name: head.label ?? '',
      productIds: rowsInGroup.map((r) => r.product_id),
      promotionIds: rowsInGroup.map((r) => r.id),
      tiers: tiersByPromotion.get(head.id as string) ?? [],
      active: head.is_active,
      startsAt: head.starts_at,
      endsAt: head.ends_at,
      createdAt: head.created_at,
    };
  });
}

adminRouter.get(
  '/promotions/groups',
  requireStaff,
  requirePermission('promotions.manage'),
  async (_req, res) => {
    return res.json(await listApiPromotionGroups());
  },
);

/**
 * One promotion as the admin screen thinks of it: the rows sharing a
 * `group_id`, collapsed back into a single object with a product list.
 */
async function toApiPromotionGroup(groupId: string) {
  const { data: rows } = await supabaseAdmin
    .from('promotions')
    .select('id, product_id, label, is_active, starts_at, ends_at, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });

  // Every row in a group carries the same label/active/window — the function
  // writes them together — so the first row answers for all of them.
  const head = rows?.[0];
  if (!head) return null;
  const { data: tiers } = await supabaseAdmin
    .from('promo_tiers')
    .select('min_qty, unit_price')
    .eq('promotion_id', head.id as string)
    .order('min_qty');

  return {
    groupId,
    name: head.label ?? '',
    productIds: rows.map((r) => r.product_id),
    promotionIds: rows.map((r) => r.id),
    tiers: (tiers ?? []).map((t) => ({ minQty: t.min_qty, unitPrice: t.unit_price })),
    active: head.is_active,
    startsAt: head.starts_at,
    endsAt: head.ends_at,
    createdAt: head.created_at,
  };
}

/**
 * Create or replace a whole promotion in one transaction.
 *
 * The per-row POST below still exists and still loops — but a loop of
 * independent inserts is not a transaction: a failure partway leaves earlier
 * products already live at bulk prices and later ones at shelf prices, on
 * real sales. `upsert_promotion_group()` (0022) does the whole edit inside
 * one function body, so it either all applies or none of it does.
 *
 * `created_by` comes from the session, never the body.
 */
adminRouter.post(
  '/promotions/bulk',
  requireStaff,
  requirePermission('promotions.manage'),
  async (req, res) => {
    const parsed = promotionGroupBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: groupId, error } = await supabaseAdmin.rpc('upsert_promotion_group', {
      p_product_ids: body.productIds,
      p_tiers: body.tiers,
      p_group_id: body.groupId ?? null,
      p_label: body.label ?? null,
      p_active: body.active,
      p_starts_at: body.startsAt ?? null,
      p_ends_at: body.endsAt ?? null,
      p_created_by: req.user!.id,
    });

    // Every guard in the function raises, so nothing was written. The message
    // is written to be shown to a person.
    if (error) return res.status(400).json({ error: error.message });

    const group = await toApiPromotionGroup(groupId as string);
    if (!group) return res.status(500).json({ error: 'Promotion did not save.' });
    return res.status(body.groupId ? 200 : 201).json(group);
  },
);

/** One promotion, by its group id — the read side of the bulk endpoint. */
adminRouter.get(
  '/promotions/group/:groupId',
  requireStaff,
  requirePermission('promotions.manage'),
  async (req, res) => {
    const group = await toApiPromotionGroup(req.params.groupId ?? '');
    if (!group) return res.status(404).json({ error: 'Promotion not found.' });
    return res.json(group);
  },
);

/**
 * Removes a whole promotion — every product row sharing the group id.
 *
 * One statement, so it is all-or-nothing for the same reason the bulk upsert
 * is: deleting a group product-by-product could leave some products still
 * priced at the offer and others back at shelf price, mid-trade.
 * `promo_tiers` cascades from `promotions`.
 */
adminRouter.delete(
  '/promotions/group/:groupId',
  requireStaff,
  requirePermission('promotions.manage'),
  async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from('promotions')
      .delete()
      .eq('group_id', req.params.groupId ?? '')
      .select('id');
    if (error) return res.status(400).json({ error: error.message });
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Promotion not found.' });
    }
    return res.status(204).end();
  },
);

/**
 * RETIRED — the non-atomic promotion writes.
 *
 * `POST /admin/promotions` looped one insert per product. A loop of
 * independent inserts is not a transaction: a failure partway through left
 * earlier products already selling at bulk prices while later ones stayed at
 * shelf price, with no record that the offer was half-applied. That is the
 * exact risk `POST /admin/promotions/bulk` exists to remove.
 *
 * `PUT /admin/promotions/:id` and `DELETE /admin/promotions/:id` are retired
 * for the same reason, one step further on: they address a SINGLE row of what
 * is now a group. Editing or deleting one row of a six-product offer leaves
 * the other five untouched and disagreeing with it — a promotion that means
 * different things depending on which product is scanned. Group-scoped
 * equivalents are above.
 *
 * They answer 410 rather than 404: the distinction between "never existed"
 * and "deliberately withdrawn, use this instead" is worth keeping for anything
 * still pointed at them.
 */
function retiredPromotionRoute(replacement: string) {
  return (_req: Request, res: Response) =>
    res.status(410).json({
      error: `This endpoint has been retired because it could apply a promotion to only some of its products. Use ${replacement} instead.`,
    });
}

adminRouter.post('/promotions', requireStaff, retiredPromotionRoute('POST /admin/promotions/bulk'));
adminRouter.put(
  '/promotions/:id',
  requireStaff,
  retiredPromotionRoute('POST /admin/promotions/bulk with the promotion’s groupId'),
);
adminRouter.delete(
  '/promotions/:id',
  requireStaff,
  retiredPromotionRoute('DELETE /admin/promotions/group/:groupId'),
);

/* ---------------------------------------------------------------------- */
/* Staff — create (default template), edit permissions, deactivate, PIN     */
/* ---------------------------------------------------------------------- */

async function toApiStaff(row: Record<string, unknown>) {
  const { data: perms } = await supabaseAdmin
    .from('staff_permissions')
    .select('permission')
    .eq('staff_id', row.id);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    // `active` — matches apps/web's Staff field name exactly (not
    // `isActive`, which is what this project's own convention elsewhere
    // uses — the mock got here first for this one field).
    active: row.is_active,
    startedAt: row.created_at ? (row.created_at as string).slice(0, 10) : null,
    // Additive over the mock's Staff shape — the real per-person grants;
    // see the B6 report. Extra keys are silently stripped by a non-strict
    // zod .parse(), so this doesn't break staffSchema validation.
    permissions: (perms ?? []).map((p) => p.permission),
    createdAt: row.created_at,
  };
}

adminRouter.get('/staff', requireStaff, requirePermission('staff.manage'), async (_req, res) => {
  const { data } = await supabaseAdmin.from('staff').select('*').order('name');
  return res.json(await Promise.all((data ?? []).map(toApiStaff)));
});

/** Creates the auth account AND the staff row. The role sets the DEFAULT template (apply_default_permissions trigger) — the owner edits per person afterward via PUT /staff/:id/permissions. */
adminRouter.post('/staff', requireStaff, requirePermission('staff.manage'), async (req, res) => {
  const parsed = staffCreateBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  // The mock's StaffInput has no password field — a temporary one is
  // generated when none is given, returned ONCE below so the owner can hand
  // it to the new starter (same "returned once, never logged" pattern as
  // B5's sell-request acceptance token).
  const tempPassword = body.password ?? crypto.randomBytes(12).toString('base64url');

  const created = await supabaseAdmin.auth.admin.createUser({
    email: body.email,
    password: tempPassword,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    return res
      .status(400)
      .json({ error: created.error?.message ?? 'Could not create the account.' });
  }

  const { data: row, error } = await supabaseAdmin
    .from('staff')
    .insert({
      id: created.data.user.id,
      email: body.email,
      name: body.name,
      role: body.role,
      phone: body.phone ?? null,
      is_active: body.active ?? true,
    })
    .select('*')
    .single();
  if (error) {
    await supabaseAdmin.auth.admin.deleteUser(created.data.user.id);
    return res.status(400).json({ error: error.message });
  }
  return res.status(201).json({
    ...(await toApiStaff(row)),
    ...(body.password ? {} : { temporaryPassword: tempPassword }),
  });
});

adminRouter.put('/staff/:id', requireStaff, requirePermission('staff.manage'), async (req, res) => {
  const parsed = staffUpdateBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.role !== undefined) patch.role = body.role; // does NOT re-apply the default template — matches "role is only the starting template"
  if (body.phone !== undefined) patch.phone = body.phone;
  // apps/web sends `active`; `isActive` stays accepted for older callers.
  const activeFlag = body.active ?? body.isActive;
  if (activeFlag !== undefined) patch.is_active = activeFlag;

  const { data: row, error } = await supabaseAdmin
    .from('staff')
    .update(patch)
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!row) return res.status(404).json({ error: 'Staff member not found.' });
  return res.json(await toApiStaff(row));
});

/** The real security boundary — per-person permission editing. */
adminRouter.put(
  '/staff/:id/permissions',
  requireStaff,
  requirePermission('staff.manage'),
  async (req, res) => {
    const parsed = staffPermissionsBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    // Replace wholesale: delete what's not in the new set, insert what's
    // missing — simplest correct way to express "this is now the exact set".
    await supabaseAdmin.from('staff_permissions').delete().eq('staff_id', req.params.id);
    if (parsed.data.permissions.length > 0) {
      const { error } = await supabaseAdmin.from('staff_permissions').insert(
        parsed.data.permissions.map((permission) => ({
          staff_id: req.params.id,
          permission,
          granted_by: req.user!.id,
        })),
      );
      if (error) return res.status(400).json({ error: error.message });
    }

    const { data: row } = await supabaseAdmin
      .from('staff')
      .select('*')
      .eq('id', req.params.id)
      .single();
    return res.json(await toApiStaff(row));
  },
);

adminRouter.post(
  '/staff/:id/pin',
  requireStaff,
  requirePermission('staff.manage'),
  async (req, res) => {
    const parsed = staffPinResetBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const pinHash = await hashPin(parsed.data.pin);
    const { error } = await supabaseAdmin
      .from('staff')
      .update({ pin_hash: pinHash })
      .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(204).end();
  },
);

/* ---------------------------------------------------------------------- */
/* Settings — the single shop_settings row                                  */
/* ---------------------------------------------------------------------- */

function toApiSettings(row: Record<string, unknown>) {
  return {
    returnWindowDays: row.return_window_days,
    idleLockMinutes: row.idle_lock_minutes,
    floatTarget: row.float_target,
    shopName: row.shop_name,
    shopAddress: row.shop_address,
    shopPhone: row.shop_phone,
    shopEmail: row.shop_email,
    openingHours: row.opening_hours,
    socialLinks: row.social_links,
    nextDayCutoffTime: row.next_day_cutoff_time,
    belowCostPromptsForReason: row.below_cost_prompts_for_reason,
    idDocumentRetentionDays: row.id_document_retention_days,
    receiptHeaderText: row.receipt_header_text,
    receiptFooterText: row.receipt_footer_text,
    customerEmailTemplates: row.customer_email_templates,
    // adminPin is deliberately absent — no column; the real dashboard lock
    // is per-staff (staff.pin_hash), proven in B1. See the B6 report.
  };
}

adminRouter.get(
  '/settings',
  requireStaff,
  requirePermission('settings.manage'),
  async (_req, res) => {
    const { data: row } = await supabaseAdmin.from('shop_settings').select('*').single();
    return res.json(toApiSettings(row));
  },
);

adminRouter.patch(
  '/settings',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const parsed = settingsPatchBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const patch: Record<string, unknown> = {};
    if (body.returnWindowDays !== undefined) patch.return_window_days = body.returnWindowDays;
    if (body.idleLockMinutes !== undefined) patch.idle_lock_minutes = body.idleLockMinutes;
    if (body.floatTarget !== undefined) patch.float_target = body.floatTarget;
    if (body.shopName !== undefined) patch.shop_name = body.shopName;
    if (body.shopAddress !== undefined) patch.shop_address = body.shopAddress;
    if (body.shopPhone !== undefined) patch.shop_phone = body.shopPhone;
    if (body.shopEmail !== undefined) patch.shop_email = body.shopEmail;
    if (body.openingHours !== undefined) patch.opening_hours = body.openingHours;
    if (body.socialLinks !== undefined) patch.social_links = body.socialLinks;
    if (body.nextDayCutoffTime !== undefined) patch.next_day_cutoff_time = body.nextDayCutoffTime;
    if (body.belowCostPromptsForReason !== undefined)
      patch.below_cost_prompts_for_reason = body.belowCostPromptsForReason;
    if (body.idDocumentRetentionDays !== undefined)
      patch.id_document_retention_days = body.idDocumentRetentionDays;
    if (body.receiptHeaderText !== undefined) patch.receipt_header_text = body.receiptHeaderText;
    if (body.receiptFooterText !== undefined) patch.receipt_footer_text = body.receiptFooterText;
    if (body.customerEmailTemplates !== undefined)
      patch.customer_email_templates = body.customerEmailTemplates;

    const { data: row, error } = await supabaseAdmin
      .from('shop_settings')
      .update(patch)
      .eq('singleton', true)
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json(toApiSettings(row));
  },
);

/* ---------------------------------------------------------------------- */
/* Label templates — the label designer's saveable shelf/price labels       */
/* ---------------------------------------------------------------------- */
// Table already existed (0009_settings.sql) with nothing pointed at it — the
// designer worked against mock data only. These are its first real routes.

function toApiLabelTemplate(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    lines: row.lines,
    barcode: row.barcode_value,
    updatedAt: row.updated_at,
  };
}

adminRouter.get('/labels', requireStaff, requirePermission('labels.manage'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('label_templates')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load label templates.' });
  return res.json((data ?? []).map(toApiLabelTemplate));
});

adminRouter.post('/labels', requireStaff, requirePermission('labels.manage'), async (req, res) => {
  const parsed = labelTemplateBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: row, error } = await supabaseAdmin
    .from('label_templates')
    .insert({
      name: body.name,
      lines: body.lines,
      barcode_value: body.barcode,
      created_by: req.user!.id,
    })
    .select('*')
    .single();
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(toApiLabelTemplate(row));
});

adminRouter.put(
  '/labels/:id',
  requireStaff,
  requirePermission('labels.manage'),
  async (req, res) => {
    const parsed = labelTemplateBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: row, error } = await supabaseAdmin
      .from('label_templates')
      .update({ name: body.name, lines: body.lines, barcode_value: body.barcode })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row)
      return res.status(404).json({ error: 'Template not found — it may have been deleted.' });
    return res.json(toApiLabelTemplate(row));
  },
);

adminRouter.delete(
  '/labels/:id',
  requireStaff,
  requirePermission('labels.manage'),
  async (req, res) => {
    const { error, count } = await supabaseAdmin
      .from('label_templates')
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    if (!count)
      return res.status(404).json({ error: 'Template not found — it may already be deleted.' });
    return res.status(204).end();
  },
);

/* ---------------------------------------------------------------------- */
/* Reviews — homepage testimonials (Round 3 follow-up #4)                   */
/* ---------------------------------------------------------------------- */
// Public reads live in reviews.routes.ts (published only, no id-agnostic
// fields leaked). Everything here is the management side: the full row,
// including unpublished ones, gated on reviews.manage — see 0053_reviews.sql
// for why that's an owner-tier permission rather than an everyday one.

function toApiReview(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    device: row.device ?? '',
    text: row.body,
    rating: row.rating,
    published: row.published,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

adminRouter.get(
  '/reviews',
  requireStaff,
  requirePermission('reviews.manage'),
  async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from('reviews')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) return res.status(500).json({ error: 'Could not load reviews.' });
    return res.json((data ?? []).map(toApiReview));
  },
);

adminRouter.post(
  '/reviews',
  requireStaff,
  requirePermission('reviews.manage'),
  async (req, res) => {
    const parsed = reviewInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: row, error } = await supabaseAdmin
      .from('reviews')
      .insert({
        name: body.name,
        device: body.device || null,
        body: body.text,
        rating: body.rating,
        published: body.published,
        sort_order: body.sortOrder,
        created_by: req.user!.id,
      })
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json(toApiReview(row));
  },
);

adminRouter.put(
  '/reviews/:id',
  requireStaff,
  requirePermission('reviews.manage'),
  async (req, res) => {
    const parsed = reviewInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: row, error } = await supabaseAdmin
      .from('reviews')
      .update({
        name: body.name,
        device: body.device || null,
        body: body.text,
        rating: body.rating,
        published: body.published,
        sort_order: body.sortOrder,
      })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row)
      return res.status(404).json({ error: 'Review not found — it may have been deleted.' });
    return res.json(toApiReview(row));
  },
);

adminRouter.delete(
  '/reviews/:id',
  requireStaff,
  requirePermission('reviews.manage'),
  async (req, res) => {
    const { error, count } = await supabaseAdmin
      .from('reviews')
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    if (!count)
      return res.status(404).json({ error: 'Review not found — it may already be deleted.' });
    return res.status(204).end();
  },
);

/* ---------------------------------------------------------------------- */
/* Product reviews (Round 5 Phase 4 #21) — moderation                       */
/* ---------------------------------------------------------------------- */
// DELIBERATELY separate from the homepage-reviews block above — see
// 0062_product_reviews.sql's header. Same permission tier (reviews.manage,
// owner-only by default): this is still "what marketing content is public",
// just customer-submitted instead of client-curated. "Approve or delete",
// per the task — there is no third "rejected" state kept around.

function toApiProductReview(row: Record<string, unknown>) {
  const product = row.products as { name: string; slug: string } | null;
  const customer = row.customers as { name: string; email: string } | null;
  return {
    id: row.id,
    productId: row.product_id,
    productName: product?.name ?? '',
    productSlug: product?.slug ?? '',
    customerName: customer?.name ?? '',
    customerEmail: customer?.email ?? '',
    rating: row.rating,
    body: row.body,
    isApproved: row.is_approved,
    createdAt: row.created_at,
  };
}

adminRouter.get(
  '/product-reviews',
  requireStaff,
  requirePermission('reviews.manage'),
  async (req, res) => {
    let query = supabaseAdmin
      .from('product_reviews')
      .select('*, products(name, slug), customers(name, email)')
      .order('created_at', { ascending: false });
    // ?status=pending|approved — the moderation queue defaults to showing
    // everything so the count on the tab and the list never disagree; the
    // screen itself is what defaults its own view to pending.
    if (req.query.status === 'pending') query = query.eq('is_approved', false);
    else if (req.query.status === 'approved') query = query.eq('is_approved', true);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Could not load product reviews.' });
    return res.json((data ?? []).map(toApiProductReview));
  },
);

adminRouter.post(
  '/product-reviews/:id/approve',
  requireStaff,
  requirePermission('reviews.manage'),
  async (req, res) => {
    const { data: row, error } = await supabaseAdmin
      .from('product_reviews')
      .update({
        is_approved: true,
        approved_by: req.user!.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select('*, products(name, slug), customers(name, email)')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Review not found.' });
    return res.json(toApiProductReview(row));
  },
);

adminRouter.delete(
  '/product-reviews/:id',
  requireStaff,
  requirePermission('reviews.manage'),
  async (req, res) => {
    const { error, count } = await supabaseAdmin
      .from('product_reviews')
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    if (!count)
      return res.status(404).json({ error: 'Review not found — it may already be deleted.' });
    return res.status(204).end();
  },
);

/* ---------------------------------------------------------------------- */
/* Device models — Repair + Sell-In dropdowns (Round 4 #FEAT-01)            */
/* ---------------------------------------------------------------------- */
// `devices` (0006_repairs.sql) already existed and already fed both flows
// through the same public GET /repair/devices (is_active=true only, so
// deactivating one here removes it from both customer-facing dropdowns
// immediately — no separate wiring per flow). Gated on inventory.manage,
// not a new permission — this is catalogue upkeep, same tier as
// categories. Soft-delete only, matching every other catalogue entity in
// this app: a device referenced by a real historical booking or sell
// request never disappears from that record, it just stops being offered
// for a NEW one.

function toApiDevice(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    priceMultiplier: Number(row.price_multiplier),
    isActive: row.is_active,
  };
}

adminRouter.get(
  '/devices',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    const { data, error } = await supabaseAdmin.from('devices').select('*').order('name');
    if (error) return res.status(500).json({ error: 'Could not load devices.' });
    return res.json((data ?? []).map(toApiDevice));
  },
);

adminRouter.post(
  '/devices',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = deviceInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: row, error } = await supabaseAdmin
      .from('devices')
      .insert({
        name: body.name,
        brand: body.brand,
        price_multiplier: body.priceMultiplier,
        is_active: body.isActive,
      })
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json(toApiDevice(row));
  },
);

adminRouter.put(
  '/devices/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = deviceInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: row, error } = await supabaseAdmin
      .from('devices')
      .update({
        name: body.name,
        brand: body.brand,
        price_multiplier: body.priceMultiplier,
        is_active: body.isActive,
      })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Device not found.' });
    return res.json(toApiDevice(row));
  },
);

adminRouter.delete(
  '/devices/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: row, error } = await supabaseAdmin
      .from('devices')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Device not found.' });
    return res.status(204).end();
  },
);

/* ---------------------------------------------------------------------- */
/* Repair types — problems & part-quality pricing (Round 5 #33)             */
/* ---------------------------------------------------------------------- */
// `repair_types` (0006_repairs.sql) already existed with real pricing
// columns (base_price_original/oem/copy) and already fed the customer-facing
// GET /repair/types — this is the first admin write path for it. Exact same
// shape as the devices block above: gated on inventory.manage (catalogue
// upkeep, same tier as devices/categories), soft-delete only (a repair
// referenced by a real historical booking keeps its name on that record
// either way; deactivating just stops it being offered for a NEW one).

function toAdminRepairType(row: Record<string, unknown>) {
  const original = row.base_price_original as number | null;
  return {
    id: row.id,
    name: row.name,
    desc: (row.description as string | null) ?? '',
    time: (row.estimate_label as string | null) ?? '',
    isActive: row.is_active,
    base:
      original === null
        ? null
        : { original, oem: row.base_price_oem as number, copy: row.base_price_copy as number },
  };
}

adminRouter.get(
  '/repair-types',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    const { data, error } = await supabaseAdmin.from('repair_types').select('*').order('name');
    if (error) return res.status(500).json({ error: 'Could not load repair types.' });
    return res.json((data ?? []).map(toAdminRepairType));
  },
);

adminRouter.post(
  '/repair-types',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = repairTypeInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: row, error } = await supabaseAdmin
      .from('repair_types')
      .insert({
        name: body.name,
        description: body.desc || null,
        estimate_label: body.time || null,
        is_active: body.isActive,
        base_price_original: body.base?.original ?? null,
        base_price_oem: body.base?.oem ?? null,
        base_price_copy: body.base?.copy ?? null,
      })
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json(toAdminRepairType(row));
  },
);

adminRouter.put(
  '/repair-types/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = repairTypeInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: row, error } = await supabaseAdmin
      .from('repair_types')
      .update({
        name: body.name,
        description: body.desc || null,
        estimate_label: body.time || null,
        is_active: body.isActive,
        base_price_original: body.base?.original ?? null,
        base_price_oem: body.base?.oem ?? null,
        base_price_copy: body.base?.copy ?? null,
      })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Repair type not found.' });
    return res.json(toAdminRepairType(row));
  },
);

adminRouter.delete(
  '/repair-types/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: row, error } = await supabaseAdmin
      .from('repair_types')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Repair type not found.' });
    return res.status(204).end();
  },
);
