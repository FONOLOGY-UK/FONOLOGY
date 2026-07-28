import { Router } from 'express';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireStaff, requirePermission } from '../middleware/auth.js';
import { hashPin } from '../lib/password.js';
import { artForCategory, DEFAULT_TILE } from '../lib/productMapping.js';
import {
  productInputBodySchema,
  stockAdjustBodySchema,
  stockReceiveBodySchema,
  stockWriteOffBodySchema,
  supplierInputBodySchema,
  promotionInputBodySchema,
  staffCreateBodySchema,
  staffUpdateBodySchema,
  staffPermissionsBodySchema,
  staffPinResetBodySchema,
  settingsPatchBodySchema,
} from '../schemas.js';

export const adminRouter = Router();

/* ---------------------------------------------------------------------- */
/* Products — full admin shape, including stock_qty and cost_price          */
/* ---------------------------------------------------------------------- */

async function toAdminProduct(row: Record<string, unknown>) {
  const [{ data: images }, { data: supplier }] = await Promise.all([
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
  ]);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sub: row.sub ?? '',
    category: row.category,
    kind: row.kind,
    price: row.price,
    // Admin sees the three-state status too (derived, same rule as the
    // storefront) plus the real numbers below — never the reverse.
    stockStatus: (row.stock_qty as number) > 0 ? 'in-stock' : 'out-of-stock',
    tag: null,
    compatibility: null,
    description: row.description ?? '',
    highlights: [] as string[],
    specs: [] as { label: string; value: string }[],
    images: (images ?? []).map((i) => i.url as string),
    art: artForCategory(row.category as string),
    tile: DEFAULT_TILE,
    // ---- StockMeta (admin-only) ----
    costPrice: row.cost_price,
    stockQty: row.stock_qty,
    supplier: supplier?.name ?? null,
    localBuying: row.supplier_id === null,
    buyInForm: null, // no column — see the B6 report
    barcode: row.barcode,
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
        category: body.category,
        kind: body.kind,
        price: body.price,
        cost_price: body.costPrice,
        stock_qty: 0, // stock only ever moves through stock_receive/stock_consume below — never set directly on create
        barcode: body.barcode || null,
        supplier_id: supplierId,
        low_stock_alert: body.lowStockAlert,
        low_stock_threshold: body.lowStockThreshold,
      })
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });

    if (body.stockQty > 0) {
      await supabaseAdmin.rpc('stock_receive', {
        p_product_id: row.id,
        p_qty: body.stockQty,
        p_unit_cost: body.costPrice,
        p_kind: 'receipt',
        p_staff_id: req.user!.id,
      });
    }
    if (body.images?.length) {
      await supabaseAdmin
        .from('product_images')
        .insert(body.images.map((url, position) => ({ product_id: row.id, url, position })));
    }

    const { data: fresh } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', row.id)
      .single();
    return res.status(201).json(await toAdminProduct(fresh));
  },
);

adminRouter.put(
  '/products/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = productInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const supplierId = body.localBuying
      ? null
      : await resolveSupplierId(body.supplier).catch(() => null);

    const { data: row, error } = await supabaseAdmin
      .from('products')
      .update({
        name: body.name,
        sub: body.sub,
        description: body.description,
        category: body.category,
        kind: body.kind,
        price: body.price,
        // cost_price and stock_qty are deliberately NOT set here — they only
        // ever move through stock_receive/stock_consume/adjust below, so the
        // weighted-average machinery is never bypassed by a plain product edit.
        barcode: body.barcode || null,
        supplier_id: supplierId,
        low_stock_alert: body.lowStockAlert,
        low_stock_threshold: body.lowStockThreshold,
      })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Product not found.' });
    return res.json(await toAdminProduct(row));
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

adminRouter.get(
  '/products/barcode/:code',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
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

async function toApiPromotion(row: Record<string, unknown>) {
  const { data: tiers } = await supabaseAdmin
    .from('promo_tiers')
    .select('min_qty, unit_price')
    .eq('promotion_id', row.id as string)
    .order('min_qty');
  return {
    id: row.id,
    name: row.label ?? '',
    productIds: [row.product_id], // schema: one promotion row is scoped to one product; see the B6 report
    tiers: (tiers ?? []).map((t) => ({ minQty: t.min_qty, unitPrice: t.unit_price })),
    active: row.is_active,
    createdAt: row.created_at,
  };
}

adminRouter.get(
  '/promotions',
  requireStaff,
  requirePermission('promotions.manage'),
  async (_req, res) => {
    const { data } = await supabaseAdmin
      .from('promotions')
      .select('*')
      .order('created_at', { ascending: false });
    return res.json(await Promise.all((data ?? []).map(toApiPromotion)));
  },
);

/**
 * The mock's Promotion covers MANY products (`productIds: Id[]`) in one
 * promotion; the schema scopes one `promotions` row to exactly one product
 * (`promotions.product_id`, singular). Creating "one promotion, many
 * products" here creates one promotions row PER product id, all sharing the
 * same label and tiers — same end result for the till (each covered product
 * gets the same bulk pricing), different underlying shape. See the report.
 */
adminRouter.post(
  '/promotions',
  requireStaff,
  requirePermission('promotions.manage'),
  async (req, res) => {
    const parsed = promotionInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const created: Record<string, unknown>[] = [];
    for (const productId of body.productIds) {
      const { data: promoRow, error } = await supabaseAdmin
        .from('promotions')
        .insert({
          product_id: productId,
          label: body.label ?? null,
          is_active: body.active,
          created_by: req.user!.id,
        })
        .select('*')
        .single();
      if (error) return res.status(400).json({ error: error.message });
      const { error: tiersErr } = await supabaseAdmin
        .from('promo_tiers')
        .insert(
          body.tiers.map((t) => ({
            promotion_id: promoRow.id,
            min_qty: t.minQty,
            unit_price: t.unitPrice,
          })),
        );
      if (tiersErr) return res.status(400).json({ error: tiersErr.message });
      created.push(promoRow);
    }
    return res.status(201).json(await Promise.all(created.map(toApiPromotion)));
  },
);

adminRouter.put(
  '/promotions/:id',
  requireStaff,
  requirePermission('promotions.manage'),
  async (req, res) => {
    const parsed = promotionInputBodySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const patch: Record<string, unknown> = {};
    if (body.label !== undefined) patch.label = body.label;
    if (body.active !== undefined) patch.is_active = body.active;
    const { data: row, error } = await supabaseAdmin
      .from('promotions')
      .update(patch)
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Promotion not found.' });

    if (body.tiers) {
      await supabaseAdmin.from('promo_tiers').delete().eq('promotion_id', row.id);
      await supabaseAdmin
        .from('promo_tiers')
        .insert(
          body.tiers.map((t) => ({
            promotion_id: row.id,
            min_qty: t.minQty,
            unit_price: t.unitPrice,
          })),
        );
    }
    return res.json(await toApiPromotion(row));
  },
);

adminRouter.delete(
  '/promotions/:id',
  requireStaff,
  requirePermission('promotions.manage'),
  async (req, res) => {
    const { error } = await supabaseAdmin.from('promotions').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(204).end();
  },
);

/* ---------------------------------------------------------------------- */
/* Staff — create (default template), edit permissions, deactivate, PIN     */
/* ---------------------------------------------------------------------- */

async function toApiStaff(row: Record<string, unknown>) {
  const { data: perms } = await supabaseAdmin
    .from('staff_permissions')
    .select('permission')
    .eq('staff_id', row.id as string);
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
  if (body.isActive !== undefined) patch.is_active = body.isActive;

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
