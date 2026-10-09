/**
 * Product variations (0107) over real HTTP — the acceptance checklist of the client's spec
 * ("Product Variation Feature — Complete Rebuild", §10), API side. Creates one product named
 * "E2E Variations <time>", works it through every rule, and retires it at the end.
 *
 *   pnpm --filter @fonology/api exec tsx scripts/e2e-variations.ts
 *
 * Needs a local API on http://localhost:4000 (never 127.0.0.1 — see e2e-test.ts) and
 * AUDIT_STAFF_EMAIL / AUDIT_STAFF_PASSWORD (an owner) in apps/api/.env.local.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { assertTestWritesAllowed } from '../src/config.js';

loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.local') });
const API = process.env.E2E_API_BASE ?? 'http://localhost:4000';

const cookies = new Map<string, string>();
async function call(method: string, url: string, body?: unknown) {
  const cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const line of set) {
    const pair = line.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

let passed = 0;
let failed = 0;
function check(ok: boolean, what: string, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${what}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

interface Variation {
  id: string;
  options: Record<string, string>;
  label: string;
  price: number;
  stockQty: number;
  isActive: boolean;
  isDefault: boolean;
  name: string | null;
  images: string[];
}
interface Structure {
  types: { id: string; name: string; values: { id: string; value: string }[] }[];
  variants: Variation[];
}

const body = (s: Structure) =>
  s.types.map((t) => ({ id: t.id, name: t.name, values: t.values.map((v) => ({ ...v })) }));

async function main() {
  assertTestWritesAllowed('e2e-variations');
  const email = process.env.AUDIT_STAFF_EMAIL;
  const password = process.env.AUDIT_STAFF_PASSWORD;
  if (!email || !password) {
    console.error('Set AUDIT_STAFF_EMAIL and AUDIT_STAFF_PASSWORD in apps/api/.env.local.');
    process.exit(1);
  }
  const signin = await call('POST', '/staff/signin', { email, password });
  if (signin.status >= 400) {
    console.error('Staff sign-in failed:', signin.body);
    process.exit(1);
  }

  const cats = await call('GET', '/admin/categories');
  if (!Array.isArray(cats.body)) {
    console.error('Could not list categories:', cats.status, cats.body);
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const category = (cats.body as any[]).find((c) => !/vape|plate/i.test(`${c.slug} ${c.label}`));
  const name = `E2E Variations ${Date.now().toString(36)}`;
  const parentImage = 'https://example.com/parent.jpg';

  console.log('Generate');
  const created = await call('POST', '/admin/products', {
    name,
    sub: 'Test product',
    categoryId: category.id,
    price: 1500,
    costPrice: 0,
    stockQty: 0,
    supplier: 'E2E Supplier',
    localBuying: false,
    lowStockAlert: false,
    lowStockThreshold: 5,
    description: 'A test product for the variations check.',
    images: [parentImage],
    variations: {
      types: [
        {
          name: 'Colour',
          values: [
            { value: 'Black', swatchHex: '#111111' },
            { value: 'White', swatchHex: '#FFFFFF' },
            { value: 'Red', swatchHex: '#cc0000' },
          ],
        },
        {
          name: 'Compatibility',
          values: [{ value: 'iPhone 13' }, { value: 'iPhone 13 Mini' }, { value: 'iPhone 13 Pro' }],
        },
      ],
      newVariations: { stockQty: 4, price: 1500, costPrice: 600 },
    },
  });
  check(created.status === 201, 'product with variations is created', created.body);
  const productId: string = created.body.id;
  const slug: string = created.body.slug;
  check(created.body.hasVariants === true, 'it is a variation product');
  check(
    created.body.stockQty === 36,
    'admin list shows the variations’ total stock (9 × 4)',
    created.body.stockQty,
  );

  let s = (await call('GET', `/admin/products/${productId}/variations`)).body as Structure;
  check(s.variants.length === 9, '3 colours × 3 models = 9 variations', s.variants.length);
  check(s.variants.filter((v) => v.isDefault).length === 1, 'exactly one default');
  check(
    s.variants[0]!.label === 'Black – iPhone 13',
    'labels read in option order',
    s.variants[0]!.label,
  );
  check(
    s.variants.every((v) => v.stockQty === 4 && v.price === 1500),
    'starting stock and price applied to all',
  );

  console.log('Add a value later');
  const withBlue = body(s);
  withBlue[0]!.values.push({ value: 'Blue' } as never);
  const preview = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: withBlue,
    dryRun: true,
  });
  check(preview.body?.preview?.create === 3, 'adding Blue previews exactly 3 new', preview.body);
  check(preview.body?.preview?.needsStartValues === true, 'and asks for their starting values');
  const refused = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: withBlue,
  });
  check(
    refused.status === 400,
    'saving without starting values is refused, not half-done',
    refused.body,
  );
  const before = new Map(s.variants.map((v) => [v.id, v]));
  // Edit one existing variation first, to prove the update leaves it alone.
  const firstId = s.variants[0]!.id;
  await call('PATCH', `/admin/products/${productId}/variations/${firstId}`, {
    price: 1999,
    name: 'Custom name',
  });
  const added = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: withBlue,
    newVariations: { stockQty: 0, price: 1700, costPrice: 700 },
  });
  check(added.status === 200, 'Update Variations succeeds', added.body);
  s = added.body as Structure;
  check(s.variants.length === 12, '12 variations now', s.variants.length);
  const first = s.variants.find((v) => v.id === firstId)!;
  check(
    first.price === 1999 && first.name === 'Custom name',
    'an existing variation keeps its price and details',
  );
  check(
    s.variants.filter((v) => before.has(v.id)).length === 9,
    'the original 9 keep their ids (nothing recreated)',
  );
  const again = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: body(s),
    dryRun: true,
  });
  check(again.body?.preview?.create === 0, 'clicking again creates no duplicates', again.body);

  console.log('Required fields');
  const blank = await call('PATCH', `/admin/products/${productId}/variations/${firstId}`, {
    price: null,
  });
  check(blank.status === 400, 'a blank selling price is refused', blank.body);

  console.log('Default, disable, storefront');
  const white13 = s.variants.find((v) => v.label === 'White – iPhone 13')!;
  const def = await call('POST', `/admin/products/${productId}/variations/${white13.id}/default`);
  check(def.status === 200, 'set as default');
  s = def.body as Structure;
  check(
    s.variants.find((v) => v.isDefault)?.id === white13.id,
    'the new default replaced the old one',
  );
  const disableDefault = await call(
    'PATCH',
    `/admin/products/${productId}/variations/${white13.id}`,
    { isActive: false },
  );
  check(disableDefault.status === 400, 'the default cannot be disabled', disableDefault.body);
  await call('PATCH', `/admin/products/${productId}/variations/${white13.id}`, { price: 2222 });

  const red = s.variants.find((v) => v.label === 'Red – iPhone 13 Mini')!;
  await call('PATCH', `/admin/products/${productId}/variations/${red.id}`, { isActive: false });
  const blackPro = s.variants.find((v) => v.label === 'Black – iPhone 13 Pro')!;
  await call('PATCH', `/admin/products/${productId}/variations/${blackPro.id}`, {
    stockQty: 0,
    images: { mode: 'replace', urls: ['https://example.com/black-pro.jpg'] },
  });

  let pdp = (await call('GET', `/products/${slug}`)).body;
  check(
    pdp?.variations?.variants?.length === 11,
    'a disabled variation is hidden from customers',
    pdp?.variations?.variants?.length,
  );
  check(pdp?.variations?.defaultVariantId === white13.id, 'the PDP opens on the default');
  check(pdp?.price === 2222, 'the listing price is the default’s price', pdp?.price);
  check(pdp?.variations?.types?.[0]?.isColour === true, 'Colour is shown as swatches');
  check(
    pdp?.variations?.types?.[0]?.values?.[0]?.swatchHex === '#111111',
    'swatch colours come through, lower-cased',
  );
  const custom = pdp.variations.variants.find((v: Variation) => v.id === firstId);
  const inherits = pdp.variations.variants.find((v: Variation) => v.id === white13.id);
  check(custom?.name === 'Custom name', 'a custom title shows');
  check(inherits?.name === name, 'a variation with no title of its own uses the parent’s');
  check(inherits?.images?.[0] === parentImage, 'a variation with no pictures shows the parent’s');
  const bp = pdp.variations.variants.find((v: Variation) => v.id === blackPro.id);
  check(bp?.images?.[0] === 'https://example.com/black-pro.jpg', 'a variation’s own pictures show');
  check(bp?.stockStatus !== 'in-stock', 'stock 0 is not in stock', bp?.stockStatus);
  check(JSON.stringify(pdp).includes('stockQty') === false, 'no stock count reaches the customer');

  const card = (await call('GET', `/products?search=${encodeURIComponent(name)}`)).body;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listed = (card as any[]).find((p) => p.slug === slug);
  check(listed?.price === 2222, 'the shop card shows the default’s price', listed?.price);

  const avail = await call(
    'GET',
    `/products/${productId}/availability?quantity=1&variantId=${blackPro.id}`,
  );
  check(avail.body?.available === false, 'an out-of-stock variation cannot be added');

  console.log('Parent changes reach inheriting variations');
  // What the product form sends — with a price and stock it has no business setting here.
  const renamed = await call('PUT', `/admin/products/${productId}`, {
    name: `${name} Renamed`,
    sub: 'Test product',
    categoryId: category.id,
    price: 1,
    costPrice: 1,
    stockQty: 999,
    supplier: 'E2E Supplier',
    localBuying: false,
    lowStockAlert: false,
    lowStockThreshold: 5,
    description: 'A test product for the variations check.',
    images: [parentImage],
  });
  check(renamed.status === 200, 'parent edit saves', renamed.body);
  check(
    renamed.body.price === 2222,
    'the form cannot overwrite a variation product’s price',
    renamed.body.price,
  );
  pdp = (await call('GET', `/products/${slug}`)).body;
  check(
    pdp.variations.variants.find((v: Variation) => v.id === white13.id)?.name === `${name} Renamed`,
    'a renamed parent renames the variations that inherit',
  );

  console.log('Bulk apply');
  s = (await call('GET', `/admin/products/${productId}/variations`)).body as Structure;
  const blacks = s.variants.filter((v) => v.options.Colour === 'Black').map((v) => v.id);
  const bulk = await call('POST', `/admin/products/${productId}/variations/bulk`, {
    variantIds: blacks,
    set: {
      price: 1234,
      stockQty: 7,
      images: { mode: 'add', urls: ['https://example.com/black.jpg'] },
    },
  });
  check(bulk.status === 200, 'bulk apply succeeds', bulk.body);
  s = bulk.body as Structure;
  const bulked = s.variants.filter((v) => blacks.includes(v.id));
  check(
    bulked.every((v) => v.price === 1234 && v.stockQty === 7),
    'price and stock set on every Black',
  );
  check(
    bulked.every((v) => v.images.includes('https://example.com/black.jpg')),
    'one picture applied to all of them',
  );
  check(
    s.variants.find((v) => v.id === blackPro.id)!.images.length === 2,
    '“add” keeps the pictures a variation already had',
  );

  console.log('Delete a value, add an option');
  const noRed = body(s);
  noRed[0]!.values = noRed[0]!.values.filter((v) => v.value !== 'Red');
  const redPreview = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: noRed,
    dryRun: true,
  });
  check(redPreview.body?.preview?.remove === 3, 'deleting Red previews 3 removed', redPreview.body);
  const redGone = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: noRed,
  });
  check(
    redGone.status === 200 && redGone.body.variants.length === 9,
    'Red removed: 9 left',
    redGone.body?.variants?.length,
  );
  s = redGone.body;

  const withStorage = [
    ...body(s),
    { name: 'Storage', values: [{ value: '128GB' }, { value: '256GB' }] },
  ];
  const ask = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: withStorage,
    dryRun: true,
  });
  check(
    JSON.stringify(ask.body?.preview?.needsAssignment) === '["Storage"]',
    'a new option asks which value the existing variations are',
    ask.body,
  );
  const storage = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: withStorage,
    assignExisting: { Storage: '128GB' },
    newVariations: { stockQty: 1, price: 2500, costPrice: 900 },
  });
  check(
    storage.status === 200 && storage.body.variants.length === 18,
    '9 existing become 128GB, 9 new 256GB',
    storage.body?.variants?.length,
  );
  check(
    storage.body.variants.find((v: Variation) => v.id === firstId)?.options.Storage === '128GB',
    'existing variations keep their data under the assigned value',
  );

  console.log('Removing the default needs a replacement');
  s = storage.body;
  const noWhite = body(s);
  noWhite[0]!.values = noWhite[0]!.values.filter((v) => v.value !== 'White');
  const whitePreview = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: noWhite,
    dryRun: true,
  });
  check(
    whitePreview.body?.preview?.needsNewDefault === true,
    'deleting the default’s value asks for a new default',
    whitePreview.body,
  );
  const whiteSave = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: noWhite,
    newDefaultOptions: { Colour: 'Black', Compatibility: 'iPhone 13', Storage: '256GB' },
  });
  check(whiteSave.status === 200, 'saves once a replacement is named', whiteSave.body);
  check(
    whiteSave.body.variants.find((v: Variation) => v.isDefault)?.label ===
      'Black – iPhone 13 – 256GB',
    'and that one is the default',
  );

  console.log('At the till');
  const tillDefault = (whiteSave.body.variants as Variation[]).find((v) => v.isDefault)!;
  const parentSale = await call('POST', '/pos/sales', {
    lines: [{ productId, quantity: 1 }],
    discount: 0,
    payments: [{ tender: 'cash', amount: tillDefault.price }],
  });
  check(parentSale.status === 400, 'the till cannot sell the parent itself', parentSale.body);
  const sale = await call('POST', '/pos/sales', {
    lines: [{ productId, variantId: tillDefault.id, quantity: 1 }],
    discount: 0,
    payments: [{ tender: 'cash', amount: tillDefault.price }],
  });
  check(sale.status === 201, 'the till sells a variation', sale.body);
  check(sale.body?.total === tillDefault.price, 'at that variation’s own price', sale.body?.total);
  const afterSale = (await call('GET', `/admin/products/${productId}/variations`))
    .body as Structure;
  check(
    afterSale.variants.find((v) => v.id === tillDefault.id)?.stockQty === tillDefault.stockQty - 1,
    'and its stock — not the parent’s — goes down by one',
  );

  console.log('Limits and switching off');
  const big = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: [
      { name: 'A', values: Array.from({ length: 11 }, (_, i) => ({ value: `a${i}` })) },
      { name: 'B', values: Array.from({ length: 10 }, (_, i) => ({ value: `b${i}` })) },
    ],
    dryRun: true,
  });
  check(big.status === 400, 'more than 100 combinations is refused', big.body);
  const dupe = await call('POST', `/admin/products/${productId}/variations/structure`, {
    types: [{ name: 'Colour', values: [{ value: 'Black' }, { value: 'black' }] }],
    dryRun: true,
  });
  check(dupe.status === 400, 'the same value twice is refused', dupe.body);

  const off = await call('DELETE', `/admin/products/${productId}/variations`);
  check(off.status === 204, 'variations can be switched off');
  const plain = (await call('GET', `/admin/products`)).body.find(
    (p: { id: string }) => p.id === productId,
  );
  check(plain?.hasVariants === false, 'the product is a plain one again');

  await call('DELETE', `/admin/products/${productId}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
