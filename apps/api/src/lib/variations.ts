import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import { mintBarcode } from './barcodes.js';
import { db, rpc, sql } from './db.js';
import { filterValidImageUrls } from './productMapping.js';
import type { VariationStructureBody } from '../schemas.js';

/**
 * Product variations (0107, client spec "Product Variation Feature — Complete Rebuild").
 *
 * A variation product's parent is a placeholder: every sellable unit is a product_variants row,
 * one per combination of the product's option values. This file is the one place that turns the
 * admin's option structure into those rows — and the reason the old feature was rebuilt is that
 * its saves failed silently, so everything here runs inside the caller's transaction and throws:
 * either the whole change lands or none of it does.
 */

export type Options = Record<string, string>;

/** Most variations one product may have (spec §11 asks for a sensible cap). */
export const MAX_VARIATIONS = 100;

/**
 * A colour option shows swatches. Decided by the option's name, the way JeezMart decides it —
 * "Colour", "Color", "Colours", "Col" — so the admin never has a separate switch to set.
 */
export function isColourType(name: string): boolean {
  return /\b(colou?rs?|col)\b/i.test(name);
}

export class VariationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Executor = Kysely<DB>;

interface TypeRow {
  id: string;
  name: string;
  position: number;
  values: { id: string; value: string; position: number; swatch_hex: string | null }[];
}

/** A product's option types with their values, both in storefront order. */
export async function loadTypes(productId: string, executor: Executor = db): Promise<TypeRow[]> {
  const types = await executor
    .selectFrom('product_variant_types')
    .select(['id', 'name', 'position'])
    .where('product_id', '=', productId)
    .orderBy('position')
    .orderBy('created_at')
    .execute();
  if (types.length === 0) return [];
  const values = await executor
    .selectFrom('product_variant_values')
    .select(['id', 'type_id', 'value', 'position', 'swatch_hex'])
    .where(
      'type_id',
      'in',
      types.map((t) => t.id),
    )
    .orderBy('position')
    .orderBy('created_at')
    .execute();
  return types.map((t) => ({ ...t, values: values.filter((v) => v.type_id === t.id) }));
}

/** "iPhone 13 Pro – Black": the values in the admin's option order. */
export function variationLabel(options: Options, typeOrder: string[]): string {
  const ordered = typeOrder.filter((t) => t in options).map((t) => options[t]!);
  const rest = Object.keys(options)
    .filter((k) => !typeOrder.includes(k))
    .map((k) => options[k]!);
  return [...ordered, ...rest].join(' – ');
}

/** A sort key putting variations in option order (first option slowest, like the matrix). */
function sortKey(options: Options, types: TypeRow[]): number[] {
  return types.map((t) => {
    const i = t.values.findIndex((v) => v.value === options[t.name]);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  });
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Same combination, whatever order the keys were written in. */
export function optionsKey(options: Options): string {
  return JSON.stringify(
    Object.keys(options)
      .sort()
      .map((k) => [k, options[k]]),
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Reading                                                                                       */
/* -------------------------------------------------------------------------------------------- */

/** Everything the admin variations screen (and the till's picker) needs, in one shape. */
export async function loadAdminVariations(productId: string, executor: Executor = db) {
  const types = await loadTypes(productId, executor);
  const rows = await executor
    .selectFrom('product_variants as v')
    .leftJoin('suppliers as s', 's.id', 'v.supplier_id')
    .selectAll('v')
    .select('s.name as supplier_name')
    .where('v.product_id', '=', productId)
    .where('v.removed_at', 'is', null)
    .execute();
  const images = rows.length
    ? await executor
        .selectFrom('product_variant_images')
        .select(['variant_id', 'url'])
        .where(
          'variant_id',
          'in',
          rows.map((r) => r.id),
        )
        .orderBy('position')
        .execute()
    : [];
  const typeOrder = types.map((t) => t.name);

  const variants = rows
    .map((r) => {
      const options = r.options as Options;
      return {
        sortKey: sortKey(options, types),
        variation: {
          id: r.id,
          productId: r.product_id,
          options,
          label: variationLabel(options, typeOrder),
          price: r.price,
          costPrice: r.cost_price,
          stockQty: r.stock_qty,
          barcode: r.barcode,
          isActive: r.is_active,
          isDefault: r.is_default,
          lowStockAlert: r.low_stock_alert,
          lowStockThreshold: r.low_stock_threshold,
          // The optional details: null = following the parent.
          name: r.name,
          description: r.description,
          tag: r.tag,
          compatibility: r.compatibility,
          supplier: r.supplier_name ?? null,
          images: filterValidImageUrls(
            images.filter((i) => i.variant_id === r.id).map((i) => i.url),
          ),
        },
      };
    })
    .sort((a, b) => compareKeys(a.sortKey, b.sortKey))
    .map((x) => x.variation);

  return {
    types: types.map((t) => ({
      id: t.id,
      name: t.name,
      isColour: isColourType(t.name),
      values: t.values.map((v) => ({ id: v.id, value: v.value, swatchHex: v.swatch_hex })),
    })),
    variants,
  };
}

export type AdminVariation = Awaited<ReturnType<typeof loadAdminVariations>>['variants'][number];

/** One variation in the admin shape (the till's barcode scan). */
export async function adminVariationById(variantId: string): Promise<AdminVariation | undefined> {
  const row = await db
    .selectFrom('product_variants')
    .select('product_id')
    .where('id', '=', variantId)
    .executeTakeFirst();
  if (!row) return undefined;
  const { variants } = await loadAdminVariations(row.product_id);
  return variants.find((v) => v.id === variantId);
}

/* -------------------------------------------------------------------------------------------- */
/* Structure: types, values and the matrix                                                       */
/* -------------------------------------------------------------------------------------------- */

interface LiveVariant {
  id: string;
  options: Options;
  is_default: boolean;
  is_active: boolean;
}

export interface StructurePlan {
  /** Combinations to create. */
  create: Options[];
  /** Variations whose option value was deleted. */
  remove: string[];
  /** Variations kept, with their options as they will read after this change. */
  keep: { id: string; options: Options; changed: boolean; isActive: boolean }[];
  total: number;
  /** New option types the existing variations still need a value for. */
  needsAssignment: string[];
  /** Variations will be created and no starting stock / prices were given. */
  needsStartValues: boolean;
  /** The current default is being deleted and no replacement was named. */
  needsNewDefault: boolean;
  /** The default after this change, by its options. */
  defaultOptions: Options | null;
  /** The variations a replacement default may be chosen from. */
  defaultCandidates: Options[];
}

const lower = (s: string) => s.trim().toLowerCase();

function cartesian(types: { name: string; values: { value: string }[] }[]): Options[] {
  let combos: Options[] = [{}];
  for (const t of types) {
    const next: Options[] = [];
    for (const c of combos) for (const v of t.values) next.push({ ...c, [t.name]: v.value });
    combos = next;
  }
  return combos;
}

/**
 * Works out what saving `body` would do to a product's variations, without changing anything.
 * Throws VariationError for a structure that can't be saved at all; returns a plan with
 * `needs…` flags for one that can, once the admin has answered the question it raises.
 */
export function planStructure(
  current: TypeRow[],
  live: LiveVariant[],
  body: VariationStructureBody,
): StructurePlan {
  const bodyTypes = body.types.map((t) => ({
    ...t,
    name: t.name.trim(),
    values: t.values.map((v) => ({ ...v, value: v.value.trim() })),
  }));

  // Names unique (case-insensitive), within the product and within each option.
  const typeNames = new Set<string>();
  for (const t of bodyTypes) {
    if (typeNames.has(lower(t.name))) {
      throw new VariationError(400, `There are two options called “${t.name}”.`);
    }
    typeNames.add(lower(t.name));
    const values = new Set<string>();
    for (const v of t.values) {
      if (values.has(lower(v.value))) {
        throw new VariationError(400, `“${v.value}” is in ${t.name} twice.`);
      }
      values.add(lower(v.value));
    }
  }

  // Ids must be this product's own — anything else means the screen is out of date.
  const currentTypeById = new Map(current.map((t) => [t.id, t]));
  const stale = () =>
    new VariationError(409, 'These options changed somewhere else. Reload and try again.');
  for (const t of bodyTypes) {
    if (!t.id) continue;
    const saved = currentTypeById.get(t.id);
    if (!saved) throw stale();
    for (const v of t.values) {
      if (v.id && !saved.values.some((s) => s.id === v.id)) throw stale();
    }
  }

  // What each saved (type, value) becomes: renamed, kept, or gone.
  const typeRename = new Map<string, string>(); // old type name -> new type name
  const valueRename = new Map<string, string>(); // `${oldType}\0${oldValue}` -> new value
  const removedValues = new Set<string>();
  for (const saved of current) {
    const next = bodyTypes.find((t) => t.id === saved.id);
    if (!next) continue; // a removed type — its key is dropped below
    typeRename.set(saved.name, next.name);
    for (const sv of saved.values) {
      const nv = next.values.find((v) => v.id === sv.id);
      if (nv) valueRename.set(`${saved.name}\0${sv.value}`, nv.value);
      else removedValues.add(`${saved.name}\0${sv.value}`);
    }
  }
  const addedTypes = bodyTypes.filter((t) => !t.id);

  const remove: string[] = [];
  const survivors: { variant: LiveVariant; options: Options }[] = [];
  const needsAssignment: string[] = [];
  const assignment = new Map<string, string>();
  for (const t of addedTypes) {
    const wanted = Object.entries(body.assignExisting ?? {}).find(
      ([k]) => lower(k) === lower(t.name),
    )?.[1];
    const match = wanted ? t.values.find((v) => lower(v.value) === lower(wanted)) : undefined;
    if (match) assignment.set(t.name, match.value);
    else needsAssignment.push(t.name);
  }

  for (const variant of live) {
    let gone = false;
    const next: Options = {};
    for (const saved of current) {
      const value = variant.options[saved.name];
      if (value === undefined) {
        gone = true; // incomplete combination: not one the matrix can hold
        break;
      }
      const key = `${saved.name}\0${value}`;
      if (removedValues.has(key)) {
        gone = true;
        break;
      }
      const newType = typeRename.get(saved.name);
      if (newType === undefined) continue; // the type itself is removed
      next[newType] = valueRename.get(key) ?? value;
    }
    if (gone) {
      remove.push(variant.id);
      continue;
    }
    for (const t of addedTypes) next[t.name] = assignment.get(t.name) ?? '';
    survivors.push({ variant, options: next });
  }

  // Assignments are only a question when there are existing variations to assign.
  const askAssignment = survivors.length > 0 ? needsAssignment : [];

  const combos = cartesian(bodyTypes);
  if (combos.length > MAX_VARIATIONS) {
    throw new VariationError(
      400,
      `That makes ${combos.length} variations — ${MAX_VARIATIONS} is the most one product can have. Split it into separate products, or use fewer values.`,
    );
  }

  let create: Options[] = [];
  const keep: StructurePlan['keep'] = [];
  if (askAssignment.length === 0) {
    const seen = new Set<string>();
    for (const s of survivors) {
      const k = optionsKey(s.options);
      if (seen.has(k)) {
        throw new VariationError(
          400,
          'Removing that option would leave two variations with the same choices. Delete its values first, keeping one, then remove the option.',
        );
      }
      seen.add(k);
      keep.push({
        id: s.variant.id,
        options: s.options,
        changed: optionsKey(s.options) !== optionsKey(s.variant.options),
        isActive: s.variant.is_active,
      });
    }
    create = combos.filter((c) => !seen.has(optionsKey(c)));
  }

  // The default: kept if it survives, replaced if the admin named one, otherwise asked for —
  // unless no existing variation survives, when the first new combination is the obvious one.
  const currentDefault = live.find((v) => v.is_default);
  const defaultSurvivor = keep.find((k) => k.id === currentDefault?.id);
  const candidates = [...keep.filter((k) => k.isActive).map((k) => k.options), ...create].sort(
    (a, b) =>
      compareKeys(
        bodyTypes.map((t) => t.values.findIndex((v) => v.value === a[t.name])),
        bodyTypes.map((t) => t.values.findIndex((v) => v.value === b[t.name])),
      ),
  );
  let defaultOptions: Options | null = null;
  let needsNewDefault = false;
  const named = body.newDefaultOptions;
  if (named && candidates.some((c) => optionsKey(c) === optionsKey(named))) {
    defaultOptions = named;
  } else if (defaultSurvivor) {
    defaultOptions = defaultSurvivor.options;
  } else if (keep.length === 0) {
    defaultOptions = candidates[0] ?? null;
  } else {
    needsNewDefault = askAssignment.length === 0;
  }

  return {
    create,
    remove,
    keep,
    total: combos.length,
    needsAssignment: askAssignment,
    needsStartValues: create.length > 0 && !body.newVariations,
    needsNewDefault,
    defaultOptions,
    defaultCandidates: needsNewDefault ? candidates : [],
  };
}

/** Throws the first unanswered question of a plan, as the message the admin sees. */
function assertAnswered(plan: StructurePlan) {
  if (plan.needsAssignment.length > 0) {
    throw new VariationError(
      400,
      `Choose which ${plan.needsAssignment.join(' and ')} the existing variations are.`,
    );
  }
  if (plan.needsStartValues) {
    throw new VariationError(
      400,
      'Enter a starting stock, selling price and cost price for the new variations.',
    );
  }
  if (plan.needsNewDefault) {
    throw new VariationError(
      400,
      'That deletes the default variation. Choose which variation becomes the default.',
    );
  }
}

/**
 * Saves a product's option structure and brings its variations in line with it, inside the
 * caller's transaction (`trx`, which must already carry the actor — see withActor). Returns the
 * plan it carried out. With `body.dryRun`, only plans.
 */
export async function saveStructure(
  trx: Executor,
  productId: string,
  body: VariationStructureBody,
  staffId: string,
): Promise<StructurePlan & { parentStockCleared: number }> {
  // One structure change per product at a time: the second waits, then plans against the first's result.
  const product = await trx
    .selectFrom('products')
    .select(['id', 'has_variants', 'stock_qty', 'barcode', 'shop_id'])
    .where('id', '=', productId)
    .forUpdate()
    .executeTakeFirst();
  if (!product) throw new VariationError(404, 'Product not found.');

  const current = await loadTypes(productId, trx);
  const live = (await trx
    .selectFrom('product_variants')
    .select(['id', 'options', 'is_default', 'is_active'])
    .where('product_id', '=', productId)
    .where('removed_at', 'is', null)
    .execute()) as LiveVariant[];

  const plan = planStructure(current, live, body);
  // Switching a plain product over: its own stock is no longer counted anywhere, so it is
  // written off in the ledger (and the admin is told how much, before saying yes).
  const parentStockCleared = product.has_variants ? 0 : product.stock_qty;
  if (body.dryRun) return { ...plan, parentStockCleared };
  assertAnswered(plan);

  if (!product.has_variants) {
    if (product.stock_qty > 0) {
      await rpc(
        'stock_consume',
        {
          p_product_id: productId,
          p_qty: product.stock_qty,
          p_kind: 'correction',
          p_staff_id: staffId,
          p_reason: 'Product switched to variations — stock is now counted per variation',
        },
        { executor: trx },
      );
    }
    await trx
      .updateTable('products')
      .set({ has_variants: true })
      .where('id', '=', productId)
      .execute();
  }

  if (plan.remove.length > 0) {
    await trx
      .updateTable('product_variants')
      .set({ removed_at: sql`now()`, is_active: false, is_default: false })
      .where('id', 'in', plan.remove)
      .execute();
  }

  // Rewrite changed combinations in two steps, so a swap (Black <-> White) never collides with
  // itself on the live-options unique index halfway through.
  const changed = plan.keep.filter((k) => k.changed);
  for (const k of changed) {
    await trx
      .updateTable('product_variants')
      .set({ options: JSON.stringify({ ...k.options, __moving__: k.id }) })
      .where('id', '=', k.id)
      .execute();
  }
  for (const k of changed) {
    await trx
      .updateTable('product_variants')
      .set({ options: JSON.stringify(k.options) })
      .where('id', '=', k.id)
      .execute();
  }

  // Types and values are rewritten whole: nothing references their ids (a variation's
  // combination is its `options`), and the array order is the storefront order.
  await trx.deleteFrom('product_variant_types').where('product_id', '=', productId).execute();
  for (const [position, t] of body.types.entries()) {
    const type = await trx
      .insertInto('product_variant_types')
      .values({ product_id: productId, name: t.name.trim(), position })
      .returning('id')
      .executeTakeFirstOrThrow();
    const colour = isColourType(t.name);
    await trx
      .insertInto('product_variant_values')
      .values(
        t.values.map((v, i) => ({
          type_id: type.id,
          value: v.value.trim(),
          position: i,
          swatch_hex: colour ? (v.swatchHex ?? null) : null,
        })),
      )
      .execute();
  }

  // The default moves before anything new is inserted as the default (one default per product).
  const defaultKey = plan.defaultOptions ? optionsKey(plan.defaultOptions) : null;
  const keptDefault = plan.keep.find((k) => optionsKey(k.options) === defaultKey);
  await trx
    .updateTable('product_variants')
    .set({ is_default: false })
    .where('product_id', '=', productId)
    .where('is_default', '=', true)
    .$if(!!keptDefault, (qb) => qb.where('id', '!=', keptDefault!.id))
    .execute();
  if (keptDefault) {
    await trx
      .updateTable('product_variants')
      .set({ is_default: true })
      .where('id', '=', keptDefault.id)
      .execute();
  }

  if (plan.create.length > 0) {
    const start = body.newVariations!;
    const created = await trx
      .insertInto('product_variants')
      .values(
        plan.create.map((options) => ({
          product_id: productId,
          options: JSON.stringify(options),
          price: start.price,
          cost_price: start.costPrice,
          stock_qty: 0, // stock only ever moves through the ledger, just below
          is_active: true,
          is_default: optionsKey(options) === defaultKey,
        })),
      )
      .returning('id')
      .execute();
    if (start.stockQty > 0) {
      for (const row of created) {
        await rpc(
          'stock_receive',
          {
            p_product_id: productId,
            p_qty: start.stockQty,
            p_unit_cost: start.costPrice,
            p_kind: 'receipt',
            p_staff_id: staffId,
            p_variant_id: row.id,
          },
          { executor: trx },
        );
      }
    }
  }

  // Switching a plain product over: the barcode already on the box belongs to the variation that
  // stands in for it — the default — not to a parent that is never sold or scanned any more.
  if (!product.has_variants && product.barcode) {
    await moveParentBarcodeToDefault(trx, productId, product.shop_id, product.barcode);
  }

  return { ...plan, parentStockCleared };
}

/**
 * The parent's barcode onto the default variation. Left where it is when the default already has
 * its own, or when another live variation in the shop holds it (the move would only fail on the
 * unique index). A deleted variation of this same product holding it — variations switched off
 * and on again — gives it up: it still counts against the index but is never sold.
 */
async function moveParentBarcodeToDefault(
  trx: Executor,
  productId: string,
  shopId: string,
  barcode: string,
) {
  const target = await trx
    .selectFrom('product_variants')
    .select(['id', 'barcode'])
    .where('product_id', '=', productId)
    .where('removed_at', 'is', null)
    .where('is_default', '=', true)
    .executeTakeFirst();
  if (!target || target.barcode) return;

  await trx
    .updateTable('product_variants')
    .set({ barcode: null })
    .where('product_id', '=', productId)
    .where('barcode', '=', barcode)
    .where('removed_at', 'is not', null)
    .execute();
  const clash = await trx
    .selectFrom('product_variants')
    .select('id')
    .where('shop_id', '=', shopId)
    .where('barcode', '=', barcode)
    .executeTakeFirst();
  if (clash) return;

  await trx.updateTable('products').set({ barcode: null }).where('id', '=', productId).execute();
  await trx.updateTable('product_variants').set({ barcode }).where('id', '=', target.id).execute();
}

/** Turns variations off: every variation is deleted and the product is a plain one again. */
export async function removeAllVariations(trx: Executor, productId: string) {
  const product = await trx
    .selectFrom('products')
    .select(['barcode', 'shop_id'])
    .where('id', '=', productId)
    .executeTakeFirst();
  const fallback = await trx
    .selectFrom('product_variants')
    .select(['id', 'barcode'])
    .where('product_id', '=', productId)
    .where('removed_at', 'is', null)
    .where('is_default', '=', true)
    .executeTakeFirst();

  await trx
    .updateTable('product_variants')
    .set({ removed_at: sql`now()`, is_active: false, is_default: false })
    .where('product_id', '=', productId)
    .where('removed_at', 'is', null)
    .execute();
  await trx.deleteFrom('product_variant_types').where('product_id', '=', productId).execute();
  await trx
    .updateTable('products')
    .set({ has_variants: false })
    .where('id', '=', productId)
    .execute();

  // The reverse of switching over: the default's barcode goes back on the plain product, so
  // turning variations on and off again loses nothing — unless another product already has it.
  if (product && !product.barcode && fallback?.barcode) {
    const clash = await trx
      .selectFrom('products')
      .select('id')
      .where('shop_id', '=', product.shop_id)
      .where('barcode', '=', fallback.barcode)
      .executeTakeFirst();
    if (!clash) {
      await trx
        .updateTable('product_variants')
        .set({ barcode: null })
        .where('id', '=', fallback.id)
        .execute();
      await trx
        .updateTable('products')
        .set({ barcode: fallback.barcode })
        .where('id', '=', productId)
        .execute();
    }
  }
}

/**
 * Mints a barcode for every live variation of `productId` that has none, inside the caller's
 * transaction. Returns how many it gave out. A case with a manufacturer's code is typed or scanned
 * in instead; this is for stock that came with nothing on it (see lib/barcodes.ts).
 */
export async function generateMissingBarcodes(trx: Executor, productId: string): Promise<number> {
  const rows = await trx
    .selectFrom('product_variants')
    .select('id')
    .where('product_id', '=', productId)
    .where('removed_at', 'is', null)
    .where('barcode', 'is', null)
    .forUpdate()
    .execute();
  // mintBarcode checks the database, which can't see this transaction's own writes yet.
  const minted = new Set<string>();
  for (const row of rows) {
    let code = await mintBarcode();
    while (minted.has(code)) code = await mintBarcode();
    minted.add(code);
    await trx
      .updateTable('product_variants')
      .set({ barcode: code })
      .where('id', '=', row.id)
      .execute();
  }
  return rows.length;
}

/* -------------------------------------------------------------------------------------------- */
/* Editing variations, one or many                                                               */
/* -------------------------------------------------------------------------------------------- */

export interface VariationEdit {
  price?: number;
  costPrice?: number;
  stockQty?: number;
  isActive?: boolean;
  lowStockAlert?: boolean;
  lowStockThreshold?: number;
  name?: string | null;
  description?: string | null;
  tag?: string | null;
  compatibility?: string | null;
  supplier?: string | null;
  images?: { mode: 'add' | 'replace' | 'inherit'; urls: string[] };
  barcode?: string | null;
}

/** Free-text supplier name -> suppliers.id, creating the row on first use. */
export async function resolveSupplierId(
  name: string | null | undefined,
  executor: Executor = db,
): Promise<string | null> {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  const existing = await executor
    .selectFrom('suppliers')
    .select('id')
    .where('name', 'ilike', trimmed)
    .executeTakeFirst();
  if (existing) return existing.id;
  const created = await executor
    .insertInto('suppliers')
    .values({ name: trimmed })
    .returning('id')
    .executeTakeFirstOrThrow();
  return created.id;
}

/**
 * Applies one edit to each of `variantIds` (all of `productId`'s, all live) inside the caller's
 * transaction. Only the keys present change. Stock moves through the ledger; a cost from someone
 * without costs.view is ignored, the same rule as a product edit.
 */
export async function editVariations(
  trx: Executor,
  productId: string,
  variantIds: string[],
  edit: VariationEdit,
  opts: { staffId: string; canSeeCosts: boolean },
) {
  const ids = [...new Set(variantIds)];
  const rows = await trx
    .selectFrom('product_variants')
    .select(['id', 'stock_qty', 'cost_price', 'is_default'])
    .where('product_id', '=', productId)
    .where('id', 'in', ids)
    .where('removed_at', 'is', null)
    .forUpdate()
    .execute();
  if (rows.length !== ids.length) {
    throw new VariationError(
      404,
      'One of those variations no longer exists. Reload and try again.',
    );
  }
  if (edit.isActive === false && rows.some((r) => r.is_default)) {
    throw new VariationError(
      400,
      'The default variation can’t be disabled. Set another variation as the default first.',
    );
  }

  const set: Record<string, unknown> = {};
  if (edit.price !== undefined) set.price = edit.price;
  if (edit.isActive !== undefined) set.is_active = edit.isActive;
  if (edit.lowStockAlert !== undefined) set.low_stock_alert = edit.lowStockAlert;
  if (edit.lowStockThreshold !== undefined) set.low_stock_threshold = edit.lowStockThreshold;
  if (edit.name !== undefined) set.name = edit.name || null;
  if (edit.description !== undefined) set.description = edit.description || null;
  if (edit.tag !== undefined) set.tag = edit.tag || null;
  if (edit.compatibility !== undefined) set.compatibility = edit.compatibility || null;
  if (edit.barcode !== undefined) set.barcode = edit.barcode || null;
  if (edit.supplier !== undefined) set.supplier_id = await resolveSupplierId(edit.supplier, trx);
  if (Object.keys(set).length > 0) {
    await trx.updateTable('product_variants').set(set).where('id', 'in', ids).execute();
  }

  const newCost = opts.canSeeCosts ? edit.costPrice : undefined;
  if (edit.stockQty !== undefined) {
    for (const r of rows) {
      const delta = edit.stockQty - r.stock_qty;
      if (delta > 0) {
        await rpc(
          'stock_receive',
          {
            p_product_id: productId,
            p_qty: delta,
            p_unit_cost: newCost ?? r.cost_price,
            p_kind: 'receipt',
            p_staff_id: opts.staffId,
            p_variant_id: r.id,
          },
          { executor: trx },
        );
      } else if (delta < 0) {
        await rpc(
          'stock_consume',
          {
            p_product_id: productId,
            p_qty: -delta,
            p_kind: 'correction',
            p_staff_id: opts.staffId,
            p_reason: 'Stock count corrected on the variations screen',
            p_variant_id: r.id,
          },
          { executor: trx },
        );
      }
    }
  }
  // After the stock moves: a receipt sets the cost from its unit cost, and this is the figure the
  // admin typed, so it is the one that stays.
  if (newCost !== undefined) {
    await trx
      .updateTable('product_variants')
      .set({ cost_price: newCost })
      .where('id', 'in', ids)
      .execute();
  }

  if (edit.images) {
    const { mode, urls } = edit.images;
    if (mode !== 'add') {
      await trx.deleteFrom('product_variant_images').where('variant_id', 'in', ids).execute();
    }
    if (mode !== 'inherit' && urls.length > 0) {
      for (const id of ids) {
        const last = await trx
          .selectFrom('product_variant_images')
          .select((eb) => eb.fn.max('position').as('max'))
          .where('variant_id', '=', id)
          .executeTakeFirst();
        const start = mode === 'add' && last?.max != null ? Number(last.max) + 1 : 0;
        const have =
          mode === 'add'
            ? new Set(
                (
                  await trx
                    .selectFrom('product_variant_images')
                    .select('url')
                    .where('variant_id', '=', id)
                    .execute()
                ).map((r) => r.url),
              )
            : new Set<string>();
        const fresh = urls.filter((u) => !have.has(u));
        if (fresh.length > 0) {
          await trx
            .insertInto('product_variant_images')
            .values(fresh.map((url, i) => ({ variant_id: id, url, position: start + i })))
            .execute();
        }
      }
    }
  }
}

/** Makes one live, enabled variation the product's default. */
export async function setDefaultVariation(trx: Executor, productId: string, variantId: string) {
  const target = await trx
    .selectFrom('product_variants')
    .select(['id', 'is_active'])
    .where('id', '=', variantId)
    .where('product_id', '=', productId)
    .where('removed_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  if (!target) throw new VariationError(404, 'Variation not found.');
  if (!target.is_active) {
    throw new VariationError(400, 'Enable this variation before making it the default.');
  }
  await trx
    .updateTable('product_variants')
    .set({ is_default: false })
    .where('product_id', '=', productId)
    .where('is_default', '=', true)
    .where('id', '!=', variantId)
    .execute();
  await trx
    .updateTable('product_variants')
    .set({ is_default: true })
    .where('id', '=', variantId)
    .execute();
}
