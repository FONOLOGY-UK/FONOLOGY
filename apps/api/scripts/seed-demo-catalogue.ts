/**
 * Adds a small, realistic demo catalogue to a LOCAL database so a tester has
 * something to browse, bag, check out and ring up. Goes through the real admin
 * API as the seeded owner (so every price/category rule is the real one).
 *
 * Safe to re-run: a product whose name already exists is skipped. Every demo
 * product has the sub-line "Demo catalogue", so it is easy to find and retire.
 * Refuses a non-local API unless ALLOW_TEST_WRITES=true.
 *
 *   pnpm --filter @fonology/api exec tsx scripts/seed-demo-catalogue.ts
 *
 * Needs `pnpm db:seed` first (owner@fonology.test).
 */
const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

const host = new URL(API).hostname;
if (
  !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) &&
  process.env.ALLOW_TEST_WRITES !== 'true'
) {
  console.error(
    `[demo-catalogue] refusing: ${host} is not this machine and ALLOW_TEST_WRITES is not true.`,
  );
  process.exit(2);
}

const cookies = new Map<string, string>();
async function call(method: string, path: string, body?: unknown) {
  const cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const pair = line.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, body: json };
}

type Demo = {
  name: string;
  category: 'mobiles' | 'accessories' | 'cases' | 'vape' | 'plates';
  price: number; // pence
  cost: number; // pence
  stock: number;
  description: string;
  inStoreOnly?: boolean;
  lowStockThreshold?: number;
};

const DEMO: Demo[] = [
  {
    name: 'iPhone 13 128GB (refurbished)',
    category: 'mobiles',
    price: 36900,
    cost: 27000,
    stock: 3,
    description:
      'Refurbished iPhone 13, fully tested, unlocked to all networks, 12 months warranty.',
  },
  {
    name: 'Samsung Galaxy S22 128GB (refurbished)',
    category: 'mobiles',
    price: 29900,
    cost: 21000,
    stock: 2,
    description: 'Refurbished Galaxy S22 in good condition, unlocked, with charger and case.',
  },
  {
    name: 'iPhone 11 64GB (refurbished)',
    category: 'mobiles',
    price: 21900,
    cost: 15000,
    stock: 0,
    description: 'Refurbished iPhone 11, currently out of stock; back in soon.',
  },
  {
    name: 'USB-C Fast Charger 20W',
    category: 'accessories',
    price: 1299,
    cost: 450,
    stock: 40,
    description: 'Compact 20W USB-C wall charger for phones and tablets.',
  },
  {
    name: 'USB-C to Lightning Cable 1m',
    category: 'accessories',
    price: 899,
    cost: 250,
    stock: 60,
    description: 'Braided 1 metre cable for fast charging and syncing.',
  },
  {
    name: 'Wireless Earbuds',
    category: 'accessories',
    price: 2499,
    cost: 1100,
    stock: 18,
    description: 'Bluetooth earbuds with charging case and up to 20 hours of battery.',
  },
  {
    name: 'Tempered Glass Screen Protector',
    category: 'accessories',
    price: 599,
    cost: 120,
    stock: 80,
    description: 'Scratch-resistant 9H glass protector, fitted free in store on request.',
  },
  {
    name: 'Power Bank 10000mAh',
    category: 'accessories',
    price: 1999,
    cost: 900,
    stock: 4,
    lowStockThreshold: 5,
    description: 'Slim 10,000 mAh power bank with two outputs. Low stock demo item.',
  },
  {
    name: 'Clear Case for iPhone 13',
    category: 'cases',
    price: 799,
    cost: 200,
    stock: 25,
    description: 'Slim clear case with raised edges to protect screen and camera.',
  },
  {
    name: 'Rugged Case for Galaxy S22',
    category: 'cases',
    price: 1199,
    cost: 350,
    stock: 12,
    description: 'Shock-absorbing case with a built-in grip, fits Samsung Galaxy S22.',
  },
  {
    name: 'Disposable Vape 600 puffs',
    category: 'vape',
    price: 599,
    cost: 300,
    stock: 30,
    description: 'Sold in store only to customers aged 18 or over.',
  },
  {
    name: 'Vape Pod Kit',
    category: 'vape',
    price: 1999,
    cost: 1000,
    stock: 8,
    description: 'Refillable pod kit. Sold in store only to customers aged 18 or over.',
  },
  {
    name: 'Road Legal Number Plate (pair)',
    category: 'plates',
    price: 2999,
    cost: 1200,
    stock: 50,
    description: 'Pair of road-legal number plates made to order; ID checks apply.',
  },
  {
    name: 'Till-only Carrier Bag',
    category: 'accessories',
    price: 10,
    cost: 3,
    stock: 200,
    inStoreOnly: true,
    description: '',
  },
];

async function main() {
  const signin = await call('POST', '/staff/signin', {
    email: 'owner@fonology.test',
    password: 'Test1234!',
  });
  if (signin.status !== 200) {
    console.error(
      `[demo-catalogue] owner sign-in failed (${signin.status}). Run pnpm db:seed first.`,
    );
    process.exit(1);
  }

  const cats = await call('GET', '/admin/categories');
  const bySlug = new Map<string, string>(
    (cats.body as { id: string; slug: string }[]).map((c) => [c.slug, c.id]),
  );
  const existing = await call('GET', '/admin/products');
  const rows: { name: string }[] = Array.isArray(existing.body)
    ? existing.body
    : (existing.body?.items ?? []);
  const have = new Set(rows.map((p) => p.name));

  let added = 0;
  let skipped = 0;
  for (const p of DEMO) {
    if (have.has(p.name)) {
      skipped++;
      continue;
    }
    const categoryId = bySlug.get(p.category);
    if (!categoryId) {
      console.error(`[demo-catalogue] no category "${p.category}" — skipping ${p.name}`);
      continue;
    }
    const res = await call('POST', '/admin/products', {
      name: p.name,
      sub: 'Demo catalogue',
      categoryId,
      price: p.price,
      costPrice: p.cost,
      stockQty: p.stock,
      localBuying: false,
      lowStockAlert: p.lowStockThreshold !== undefined,
      lowStockThreshold: p.lowStockThreshold ?? 3,
      inStoreOnly: p.inStoreOnly ?? false,
      description: p.description,
    });
    if (res.status === 201) added++;
    else console.error(`[demo-catalogue] ${p.name}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  console.log(`[demo-catalogue] added ${added}, already there ${skipped}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
