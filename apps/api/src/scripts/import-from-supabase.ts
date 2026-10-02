/**
 * One-off import from the old Supabase database (the dev project,
 * ohkvwqqtppvnxbvvdsfr) into a FRESHLY MIGRATED database — this machine's or
 * the server's. Brings the shop's set-up, never its trading history:
 *
 *   catalogue   categories (matched by slug), active non-fixture products with
 *               their photos (copied into Garage, URLs rewritten), variants,
 *               suppliers, promotions, till folders
 *   repairs     active devices, repair types, part tiers
 *   shop        shop_settings, delivery zones/rates/postcodes, reviews, label
 *               templates
 *   staff       every staff member with their sign-in (email + Supabase's
 *               bcrypt hash — re-hashed to argon2id on first sign-in), their
 *               exact permissions, their till favourites
 *
 * NOT imported: sales, orders, refunds, jobs, bookings, cash, day close,
 * customers, sessions, print jobs, audit log — and no e2e fixtures (names
 * starting E2E / PW<digits>), retired products, or obvious test suppliers.
 *
 * Stock is not copied as a number: stock only moves through stock_movements
 * (a trigger keeps the two in step), so each product arrives at 0 and gets one
 * 'correction' movement for its old count — the ledger and the count agree
 * from the first day.
 *
 * Refuses a target that already has products or staff. Everything is one
 * transaction: it all lands, or nothing does.
 *
 *   DEV_SUPABASE_DB_URL=… pnpm --filter @fonology/api import:supabase --dry-run
 *   DEV_SUPABASE_DB_URL=… pnpm --filter @fonology/api import:supabase
 *   node dist/scripts/import-from-supabase.js        (in the API image)
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';
import { BUCKETS, publicImageUrl, putObject } from '../lib/storage.js';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env.local'),
});

const DRY_RUN = process.argv.includes('--dry-run');
const SOURCE_URL = process.env.DEV_SUPABASE_DB_URL;

const FIXTURE_NAME = /^(e2e\b|pw\d)/i;
const TEST_SUPPLIER = /^(e2e|hehe|abc|hi|temp)$|test|^temp\b|bug-\d/i;
const OPENING_STOCK_REASON = 'Opening stock — imported from the old system';

type Row = Record<string, unknown>;

function log(message: string) {
  console.log(`  [import] ${message}`);
}

async function main() {
  if (!SOURCE_URL) {
    throw new Error('Set DEV_SUPABASE_DB_URL (the old Supabase database) to import from.');
  }
  const source = new pg.Client({
    connectionString: SOURCE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const target = new pg.Client({ connectionString: config.databaseUrl });
  await source.connect();
  await target.connect();

  const read = async (sql: string, params: unknown[] = []) =>
    (await source.query<{ j: Row }>(sql, params)).rows.map((r) => r.j);

  try {
    const { rows: existing } = await target.query<{ products: number; staff: number }>(
      'select (select count(*) from public.products)::int products, (select count(*) from public.staff)::int staff',
    );
    if (existing[0]!.products > 0 || existing[0]!.staff > 0) {
      throw new Error(
        `The target already has ${existing[0]!.products} product(s) and ${existing[0]!.staff} staff — ` +
          'import only into a freshly migrated database.',
      );
    }

    /* ------------------------------ read ------------------------------ */

    const products = (
      await read(
        `select to_jsonb(p) j from public.products p where p.is_active order by created_at`,
      )
    ).filter((p) => !FIXTURE_NAME.test(String(p.name)));
    const productIds = products.map((p) => p.id as string);

    const categories = await read(
      `select to_jsonb(c) j from public.categories c order by parent_id nulls first`,
    );
    const usedSupplierIds = new Set(products.map((p) => p.supplier_id).filter(Boolean));
    const suppliers = (await read(`select to_jsonb(s) j from public.suppliers s`)).filter(
      (s) => usedSupplierIds.has(s.id) || !TEST_SUPPLIER.test(String(s.name)),
    );
    const variants = await read(
      `select to_jsonb(v) j from public.product_variants v where product_id = any($1)`,
      [productIds],
    );
    const images = await read(
      `select to_jsonb(i) j from public.product_images i where product_id = any($1) order by position`,
      [productIds],
    );
    const promotions = await read(
      `select to_jsonb(p) j from public.promotions p where product_id = any($1)`,
      [productIds],
    );
    const promoTiers = await read(
      `select to_jsonb(t) j from public.promo_tiers t where promotion_id = any($1)`,
      [promotions.map((p) => p.id)],
    );
    const folderItems = await read(
      `select to_jsonb(f) j from public.product_folder_items f where product_id = any($1)`,
      [productIds],
    );
    const folders = await read(
      `select to_jsonb(f) j from public.product_folders f where id = any($1)`,
      [[...new Set(folderItems.map((f) => f.folder_id))]],
    );

    const devices = await read(`select to_jsonb(d) j from public.devices d where is_active`);
    const repairTypes = await read(`select to_jsonb(r) j from public.repair_types r`);
    const partTiers = await read(`select to_jsonb(t) j from public.repair_part_tiers t`);

    const [settings] = await read(`select to_jsonb(s) j from public.shop_settings s`);
    const zones = await read(`select to_jsonb(z) j from public.delivery_zones z`);
    const rates = await read(`select to_jsonb(r) j from public.delivery_rates r`);
    const prefixes = await read(`select to_jsonb(p) j from public.delivery_postcode_prefixes p`);
    const reviews = await read(`select to_jsonb(r) j from public.reviews r`);
    const labelTemplates = (await read(`select to_jsonb(l) j from public.label_templates l`)).map(
      (l) => ({
        ...l,
        linked_product_id: productIds.includes(l.linked_product_id as string)
          ? l.linked_product_id
          : null,
      }),
    );

    const staff = await read(`select to_jsonb(s) j from public.staff s`);
    const accounts = await read(
      `select jsonb_build_object('id', u.id, 'email', lower(u.email), 'password_hash', u.encrypted_password,
              'email_verified_at', u.email_confirmed_at, 'created_at', u.created_at) j
         from auth.users u where u.id in (select id from public.staff)`,
    );
    const permissions = await read(`select to_jsonb(p) j from public.staff_permissions p`);
    const favourites = await read(
      `select to_jsonb(f) j from public.staff_favourite_products f where product_id = any($1)`,
      [productIds],
    );

    /* ------------------------------ write ----------------------------- */

    await target.query('begin');

    // Column lists come from the TARGET table, so a column that exists on only
    // one side is never written; jsonb_populate_recordset casts each value to
    // the column's real type (enums, the pence domain, arrays).
    const columnsOf = async (table: string) =>
      (
        await target.query<{ name: string }>(
          `select attname name from pg_attribute
            where attrelid = $1::regclass and attnum > 0 and not attisdropped and attgenerated = ''`,
          [`public.${table}`],
        )
      ).rows.map((r) => r.name);

    const insert = async (table: string, rows: Row[], onConflict = '') => {
      if (!rows.length) return;
      // Only columns the source rows carry: a column they lack takes its
      // default, rather than the NULL jsonb_populate_recordset would give it.
      const present = new Set(rows.flatMap((r) => Object.keys(r)));
      const cols = (await columnsOf(table))
        .filter((c) => present.has(c))
        .map((c) => `"${c}"`)
        .join(', ');
      await target.query(
        `insert into public.${table} (${cols})
         select ${cols} from jsonb_populate_recordset(null::public.${table}, $1::jsonb) ${onConflict}`,
        [JSON.stringify(rows)],
      );
    };

    // Categories: the migrations already made the protected ones (vape,
    // plates, mobiles…) under their own ids, so match on slug and map.
    const { rows: targetCats } = await target.query<{
      id: string;
      slug: string;
      is_protected: boolean;
    }>('select id, slug, is_protected from public.categories');
    const catId = new Map<string, string>(); // source id -> target id
    for (const cat of categories) {
      const match = targetCats.find((t) => t.slug === cat.slug);
      if (match) {
        catId.set(cat.id as string, match.id);
      } else {
        await insert('categories', [{ ...cat, parent_id: null }]);
        catId.set(cat.id as string, cat.id as string);
      }
    }
    for (const cat of categories) {
      const id = catId.get(cat.id as string)!;
      const parent = cat.parent_id ? catId.get(cat.parent_id as string)! : null;
      const protectedHere = targetCats.find((t) => t.id === id)?.is_protected;
      if (!protectedHere) {
        await target.query(
          'update public.categories set label = $2, parent_id = $3 where id = $1',
          [id, cat.label, parent],
        );
      }
    }
    const sourceSlugs = new Set(categories.map((c) => c.slug));
    const { rowCount: droppedCats } = await target.query(
      'delete from public.categories where not is_protected and not (slug = any($1))',
      [[...sourceSlugs]],
    );

    // Repair + delivery reference data: the migrations seed a starting set;
    // the old system's edited set replaces it wholesale.
    await target.query('delete from public.delivery_postcode_prefixes');
    await target.query('delete from public.delivery_rates');
    await target.query('delete from public.delivery_zones');
    await insert('delivery_zones', zones);
    await insert('delivery_rates', rates);
    await insert('delivery_postcode_prefixes', prefixes);
    await target.query('delete from public.repair_types');
    await insert('repair_types', repairTypes);
    await insert(
      'repair_part_tiers',
      partTiers,
      'on conflict (id) do update set name = excluded.name, strap_line = excluded.strap_line, warranty_label = excluded.warranty_label, sort_order = excluded.sort_order',
    );
    await insert('devices', devices);

    // Staff: sign-in first (staff.id references it), then the profile, then the
    // permissions exactly as they were — the insert trigger grants the role's
    // defaults, which are replaced, not merged.
    await insert('user_accounts', accounts);
    await insert(
      'staff',
      staff.map((s) => ({ ...s, last_seen_at: null })),
    );
    await target.query('delete from public.staff_permissions');
    await insert('staff_permissions', permissions);

    // Catalogue.
    await insert('suppliers', suppliers);
    await insert(
      'products',
      products.map((p) => ({
        ...p,
        category_id: p.category_id ? catId.get(p.category_id as string) : null,
        supplier_id: suppliers.some((s) => s.id === p.supplier_id) ? p.supplier_id : null,
        stock_qty: 0,
      })),
    );
    await insert(
      'product_variants',
      variants.map((v) => ({ ...v, stock_qty: 0 })),
    );

    let opening = 0;
    for (const item of [
      ...products.map((p) => ({ product_id: p.id, variant_id: null, qty: Number(p.stock_qty) })),
      ...variants.map((v) => ({
        product_id: v.product_id,
        variant_id: v.id,
        qty: Number(v.stock_qty),
      })),
    ]) {
      if (!item.qty) continue;
      await target.query(
        `insert into public.stock_movements (product_id, variant_id, kind, qty_delta, reason, source_type)
         values ($1, $2, 'correction', $3, $4, 'import')`,
        [item.product_id, item.variant_id, item.qty, OPENING_STOCK_REASON],
      );
      opening += 1;
    }

    // Photos: copied into Garage under the same key, URL rewritten.
    const copiedImages: Row[] = [];
    for (const image of images) {
      const url = String(image.url);
      const key = url.split('/').pop()!;
      if (!DRY_RUN) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not download ${url} (${response.status})`);
        await putObject(
          BUCKETS.productImages,
          key,
          Buffer.from(await response.arrayBuffer()),
          response.headers.get('content-type') ?? 'image/png',
        );
      }
      copiedImages.push({ ...image, url: publicImageUrl(key) });
    }
    await insert('product_images', copiedImages);

    await insert('promotions', promotions);
    await insert('promo_tiers', promoTiers);
    await insert('product_folders', folders);
    await insert('product_folder_items', folderItems);
    await insert('staff_favourite_products', favourites);
    await insert('label_templates', labelTemplates);
    await insert('reviews', reviews);

    // Shop settings: the singleton row is updated in place, every column.
    if (settings) {
      const cols = (await columnsOf('shop_settings')).filter(
        (c) => !['singleton', 'created_at', 'updated_at'].includes(c) && c in settings,
      );
      const list = cols.map((c) => `"${c}"`).join(', ');
      await target.query(
        `update public.shop_settings set (${list}) =
           (select ${list} from jsonb_populate_record(null::public.shop_settings, $1::jsonb))`,
        [JSON.stringify(settings)],
      );
    }

    log(`categories: ${categories.length} (${droppedCats ?? 0} unused seeded ones removed)`);
    log(`products: ${products.length} — ${products.map((p) => p.name).join(', ')}`);
    log(
      `opening-stock movements: ${opening}; variants: ${variants.length}; photos: ${copiedImages.length}`,
    );
    log(`suppliers: ${suppliers.length} — ${suppliers.map((s) => s.name).join(', ')}`);
    log(
      `promotions: ${promotions.length}; folders: ${folders.length}; favourites: ${favourites.length}`,
    );
    log(
      `devices: ${devices.length}; repair types: ${repairTypes.length}; part tiers: ${partTiers.length}`,
    );
    log(
      `delivery: ${zones.length} zones, ${rates.length} rates, ${prefixes.length} postcode prefixes`,
    );
    log(
      `reviews: ${reviews.length}; label templates: ${labelTemplates.length}; shop settings: ${settings ? 'yes' : 'NONE'}`,
    );
    log(`staff: ${staff.length} (${accounts.length} sign-ins, ${permissions.length} permissions)`);

    if (DRY_RUN) {
      await target.query('rollback');
      log('dry run — everything above was rolled back; nothing was written.');
    } else {
      await target.query('commit');
      log('committed.');
    }
  } catch (err) {
    await target.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error('[import] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
