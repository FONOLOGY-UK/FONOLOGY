/**
 * Gives a FRESHLY MIGRATED database the shop's starting set-up from
 * deploy/shop-setup.json — the one step between "migrations applied" and "the owner
 * can sign in" on the server (docs/go-live.md §5).
 *
 *   shopSettings   the listed shop_settings columns (the rest come from the migrations)
 *   categories     the shop's own tree; unlisted, unprotected seeded ones are removed
 *   repairTypes    added beside the migrations' "Something else", with their part grades
 *   devices        the "Other / not listed" catch-all and the repairs it offers
 *   owner          one owner account, with a temporary password printed ONCE
 *
 * Why a reviewed file and not a copy of the dev database: the dev database is a test
 * database (tester-made devices and prices, demo products, ~200 test accounts). Only these
 * values in it were the shop's; written down here, nothing else can ride along.
 *
 * Refuses a database that already has staff, and runs as one transaction: it all lands,
 * or nothing does.
 *
 *   node dist/scripts/setup-shop.js --dry-run     (in the API image; prints, writes nothing)
 *   node dist/scripts/setup-shop.js
 *   pnpm --filter @fonology/api exec tsx src/scripts/setup-shop.ts --file <path>
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';
import { hashPassword } from '../lib/password.js';

const DRY_RUN = process.argv.includes('--dry-run');
const fileArg = process.argv.indexOf('--file');
// src/scripts and dist/scripts are both four levels below the repo root (/app in the image).
const FILE =
  fileArg > 0
    ? path.resolve(process.argv[fileArg + 1]!)
    : path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../deploy/shop-setup.json',
      );

interface Setup {
  shopSettings: Record<string, unknown>;
  categories: { list: { slug: string; label: string; parent?: string }[] };
  repairTypes: {
    list: {
      name: string;
      description: string | null;
      estimateLabel: string | null;
      diagnosisOnly: boolean;
      subTypes: string[];
    }[];
  };
  devices: {
    list: {
      name: string;
      brand: string;
      prices: { repairType: string; subType: string | null; price: number }[];
    }[];
  };
  owner: { name: string; email: string; phone?: string | null };
}

function log(message: string) {
  console.log(`  [setup] ${message}`);
}

async function main() {
  const setup = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Setup;
  log(`from ${FILE}${DRY_RUN ? ' (dry run)' : ''}`);
  const db = new pg.Client({ connectionString: config.databaseUrl });
  await db.connect();
  try {
    const { rows: staffCount } = await db.query<{ n: number }>(
      'select count(*)::int n from public.staff',
    );
    if (staffCount[0]!.n > 0) {
      throw new Error(
        `The database already has ${staffCount[0]!.n} staff — this runs once, on a freshly migrated database.`,
      );
    }
    await db.query('begin');

    /* shop settings: only the columns the file names, each checked to exist */
    const { rows: settingCols } = await db.query<{ name: string }>(
      `select attname name from pg_attribute
        where attrelid = 'public.shop_settings'::regclass and attnum > 0 and not attisdropped`,
    );
    const known = new Set(settingCols.map((c) => c.name));
    const settings = Object.entries(setup.shopSettings).filter(([k]) => !k.startsWith('$'));
    for (const [column] of settings) {
      if (!known.has(column)) throw new Error(`shop_settings has no column "${column}"`);
    }
    if (settings.length) {
      const list = settings.map(([c]) => `"${c}"`).join(', ');
      await db.query(
        `update public.shop_settings set (${list}) =
           (select ${list} from jsonb_populate_record(null::public.shop_settings, $1::jsonb))`,
        [JSON.stringify(Object.fromEntries(settings))],
      );
    }
    log(`shop settings: ${settings.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`);

    /* categories: upsert by slug, then parents, then drop the unlisted unprotected ones */
    for (const c of setup.categories.list) {
      await db.query(
        `insert into public.categories (slug, label) values ($1, $2)
         on conflict (slug) do update set label = excluded.label`,
        [c.slug, c.label],
      );
    }
    for (const c of setup.categories.list) {
      await db.query(
        `update public.categories set parent_id = (select id from public.categories where slug = $2)
          where slug = $1`,
        [c.slug, c.parent ?? null],
      );
    }
    const { rows: dropped } = await db.query<{ slug: string }>(
      `delete from public.categories
        where not is_protected and not (slug = any($1))
          and not exists (select 1 from public.products p where p.category_id = categories.id)
        returning slug`,
      [setup.categories.list.map((c) => c.slug)],
    );
    const { rows: tree } = await db.query<{ label: string; parent: string | null }>(
      `select c.label, p.label parent from public.categories c
         left join public.categories p on p.id = c.parent_id order by 2 nulls first, 1`,
    );
    log(
      `categories: ${tree.map((c) => (c.parent ? `${c.parent} › ${c.label}` : c.label)).join(', ')}` +
        (dropped.length ? ` (removed ${dropped.map((d) => d.slug).join(', ')})` : ''),
    );

    /* repair types: by name, with their part grades */
    for (const r of setup.repairTypes.list) {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.repair_types (name, description, estimate_label, diagnosis_only, is_active)
         values ($1, $2, $3, $4, true) returning id`,
        [r.name, r.description, r.estimateLabel, r.diagnosisOnly],
      );
      if (r.subTypes.length) {
        const { rowCount } = await db.query(
          `insert into public.repair_type_sub_types (repair_type_id, sub_type_id)
           select $1, id from public.repair_sub_types where legacy_tier::text = any($2)`,
          [rows[0]!.id, r.subTypes],
        );
        if (rowCount !== r.subTypes.length) {
          throw new Error(
            `${r.name}: found ${rowCount} of the part grades ${r.subTypes.join(', ')}`,
          );
        }
      }
    }
    log(`repair types added: ${setup.repairTypes.list.map((r) => r.name).join(', ')}`);

    /* devices: each with the repairs it offers (no price row = not offered on that device) */
    for (const d of setup.devices.list) {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.devices (name, brand) values ($1, $2) returning id`,
        [d.name, d.brand],
      );
      for (const p of d.prices) {
        const { rowCount } = await db.query(
          `insert into public.device_repair_prices (device_id, repair_type_id, sub_type_id, price)
           select $1, rt.id, st.id, $4
             from public.repair_types rt
             left join public.repair_sub_types st on st.legacy_tier::text = $3
            where rt.name = $2 and ($3::text is null or st.id is not null)`,
          [rows[0]!.id, p.repairType, p.subType, p.price],
        );
        if (rowCount !== 1) {
          throw new Error(
            `${d.name}: no repair "${p.repairType}"${p.subType ? ` / ${p.subType}` : ''}`,
          );
        }
      }
    }
    log(
      `devices: ${setup.devices.list.map((d) => `${d.name} (${d.prices.length} repairs)`).join(', ')}`,
    );

    /* the owner: a sign-in, then the staff row (the insert trigger grants the owner's permissions) */
    const temporaryPassword = randomBytes(12).toString('base64url');
    const email = setup.owner.email.trim().toLowerCase();
    const { rows: account } = await db.query<{ id: string }>(
      `insert into public.user_accounts (email, password_hash, email_verified_at)
       values ($1, $2, now()) returning id`,
      [email, await hashPassword(temporaryPassword)],
    );
    await db.query(
      `insert into public.staff (id, email, name, role, phone, shop_id)
       values ($1, $2, $3, 'owner', $4,
               (select id from public.shops where is_fulfilment_hub order by created_at limit 1))`,
      [account[0]!.id, email, setup.owner.name, setup.owner.phone ?? null],
    );
    const { rows: perms } = await db.query<{ n: number }>(
      'select count(*)::int n from public.staff_permissions where staff_id = $1',
      [account[0]!.id],
    );
    log(`owner: ${email} (${perms[0]!.n} permissions)`);

    if (DRY_RUN) {
      await db.query('rollback');
      log('dry run — everything above was rolled back; nothing was written.');
      return;
    }
    await db.query('commit');
    log('committed.');
    console.log(`
  The owner signs in at /staff-login with:
    email     ${email}
    password  ${temporaryPassword}
  This is shown once and stored nowhere. Hand it over directly, then change it
  (Forgot password, once email is set up) and set a till PIN.`);
  } catch (err) {
    await db.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('[setup] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
