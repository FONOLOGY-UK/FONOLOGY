/**
 * Repair pricing per device (0109, tester change C-3) over real HTTP — the doc's acceptance
 * criteria, API side. Creates its own sub-type, repairs and devices (named "E2E RP …") and
 * switches them off / deletes them at the end.
 *
 *   pnpm --filter @fonology/api exec tsx scripts/e2e-repair-pricing.ts
 *
 * Needs a local API on http://localhost:4000 and AUDIT_STAFF_EMAIL / AUDIT_STAFF_PASSWORD (an
 * owner) in apps/api/.env.local.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { assertTestWritesAllowed } from '../src/config.js';

loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.local') });
const API = process.env.E2E_API_BASE ?? 'http://localhost:4000';

const cookies = new Map<string, string>();
async function call(method: string, url: string, body?: unknown, guest = false) {
  const cookie = guest ? '' : [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
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

/** A customer with no account — booking a repair needs no session, and staff may not book. */
const guestCall = (method: string, url: string, body?: unknown) => call(method, url, body, true);

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

async function main() {
  assertTestWritesAllowed('e2e-repair-pricing');
  const email = process.env.AUDIT_STAFF_EMAIL;
  const password = process.env.AUDIT_STAFF_PASSWORD;
  if (!email || !password) {
    console.error('Set AUDIT_STAFF_EMAIL and AUDIT_STAFF_PASSWORD in apps/api/.env.local.');
    process.exit(1);
  }
  if ((await call('POST', '/staff/signin', { email, password })).status >= 400) {
    console.error('Staff sign-in failed.');
    process.exit(1);
  }
  const run = Date.now().toString(36);

  console.log('Sub-types');
  const defaults = (await call('GET', '/admin/repair-sub-types')).body as {
    id: string;
    name: string;
  }[];
  check(
    ['Original', 'OEM', 'Copy'].every((n) => defaults.some((d) => d.name === n)),
    'Original, OEM and Copy exist by default',
  );
  const premium = await call('POST', '/admin/repair-sub-types', {
    name: `E2E RP Premium ${run}`,
    warranty: '24-month warranty',
  });
  check(premium.status === 201, 'a custom sub-type can be added', premium.body);
  const renamed = await call('PUT', `/admin/repair-sub-types/${premium.body.id}`, {
    name: `E2E RP Premium+ ${run}`,
    warranty: '24-month warranty',
  });
  check(renamed.status === 200 && renamed.body.name.endsWith(run), 'and edited');
  const original = defaults.find((d) => d.name === 'Original')!;
  const copy = defaults.find((d) => d.name === 'Copy')!;
  const oem = defaults.find((d) => d.name === 'OEM')!;

  console.log('Repair types are definitions only');
  const screen = await call('POST', '/admin/repair-types', {
    name: `E2E RP Screen ${run}`,
    desc: 'Glass and display',
    time: '1 hour',
    isActive: true,
    diagnosisOnly: false,
    subTypeIds: [original.id, oem.id, copy.id, premium.body.id],
  });
  check(screen.status === 201, 'a repair type is created with its sub-types', screen.body);
  check(
    !JSON.stringify(screen.body).match(/price|base/i),
    'and carries no price of any kind',
    screen.body,
  );
  const diag = await call('POST', '/admin/repair-types', {
    name: `E2E RP Water ${run}`,
    desc: '',
    time: '',
    isActive: true,
    diagnosisOnly: true,
    subTypeIds: [original.id],
  });
  check(
    diag.status === 201 && diag.body.diagnosisOnly && diag.body.subTypeIds.length === 0,
    'Diagnosis only clears any sub-types',
    diag.body,
  );

  console.log('Device prices — blank = not offered, 0 = free');
  const a = await call('POST', '/admin/devices', {
    name: `E2E RP Phone A ${run}`,
    brand: 'apple',
    isActive: true,
    prices: [
      { repairTypeId: screen.body.id, subTypeId: original.id, price: 15000 },
      { repairTypeId: screen.body.id, subTypeId: copy.id, price: 6000 },
      { repairTypeId: screen.body.id, subTypeId: premium.body.id, price: 0 },
      { repairTypeId: diag.body.id, subTypeId: null, price: 2000 },
    ],
  });
  check(a.status === 201, 'a device is created with its own prices', a.body);
  check(!('priceMultiplier' in a.body), 'no multiplier anywhere on a device');
  const badFlat = await call('PUT', `/admin/devices/${a.body.id}`, {
    name: a.body.name,
    brand: 'apple',
    isActive: true,
    prices: [{ repairTypeId: screen.body.id, subTypeId: null, price: 100 }],
  });
  check(badFlat.status === 400, 'a flat price on a standard repair is refused', badFlat.body);

  const offersA = (await call('GET', `/repair/offers?deviceId=${a.body.id}`)).body as {
    repairId: string;
    subTypeId: string | null;
    price: number;
  }[];
  const mine = offersA.filter((o) => o.repairId === screen.body.id || o.repairId === diag.body.id);
  check(mine.length === 4, 'the device offers exactly what was priced', mine);
  check(
    !mine.some((o) => o.subTypeId === oem.id),
    'OEM, left blank, is not offered on this device',
  );
  check(
    mine.some((o) => o.subTypeId === premium.body.id && o.price === 0),
    'a price of 0 is offered (free), not treated as blank',
  );
  check(
    mine.some((o) => o.repairId === diag.body.id && o.subTypeId === null && o.price === 2000),
    'the Diagnosis-only repair is one option with its flat price',
  );

  console.log('Duplicate pricing copies values, not a link');
  const prices = (await call('GET', `/admin/devices/${a.body.id}/prices`)).body;
  const b = await call('POST', '/admin/devices', {
    name: `E2E RP Phone B ${run}`,
    brand: 'apple',
    isActive: true,
    prices,
  });
  check(b.status === 201, 'device B is created from A’s price list');
  const bPrices = (await call('GET', `/admin/devices/${b.body.id}/prices`)).body as unknown[];
  check(bPrices.length === 4, 'with the full matrix copied', bPrices);
  await call('PUT', `/admin/devices/${b.body.id}`, {
    name: b.body.name,
    brand: 'apple',
    isActive: true,
    prices: [{ repairTypeId: screen.body.id, subTypeId: original.id, price: 99900 }],
  });
  const aAfter = (await call('GET', `/admin/devices/${a.body.id}/prices`)).body as {
    subTypeId: string | null;
    price: number;
  }[];
  check(
    aAfter.find((p) => p.subTypeId === original.id)?.price === 15000 && aAfter.length === 4,
    'editing B later leaves A exactly as it was',
    aAfter,
  );

  console.log('Website booking is priced from the device');
  const booking = await guestCall('POST', '/repair/bookings', {
    deviceId: a.body.id,
    repairId: screen.body.id,
    subTypeId: copy.id,
    name: 'E2E RP Customer',
    phone: '07700900123',
    email: `e2e-rp-${run}@example.invalid`,
    address: '1 Test Street',
    postcode: 'G46 7AA',
    preferredContact: 'email',
  });
  check(
    booking.status === 201 && booking.body.price === 6000,
    'a booking takes the device’s price',
    booking.body,
  );
  check(booking.body?.subTypeName === 'Copy', 'and names the sub-type');
  const notOffered = await guestCall('POST', '/repair/bookings', {
    deviceId: a.body.id,
    repairId: screen.body.id,
    subTypeId: oem.id,
    name: 'E2E RP Customer',
    phone: '07700900123',
    email: `e2e-rp-${run}@example.invalid`,
    address: '1 Test Street',
    postcode: 'G46 7AA',
    preferredContact: 'email',
  });
  check(
    notOffered.status === 400,
    'a sub-type left blank on the device cannot be booked',
    notOffered.body,
  );

  console.log('Job creation');
  const jobBase = {
    source: 'walk_in',
    customerName: 'E2E RP Job',
    deviceDescription: 'Phone A',
    problemDescription: 'Screen',
  };
  const priced = await call('POST', '/jobs', {
    ...jobBase,
    deviceId: a.body.id,
    repairTypeId: screen.body.id,
    subTypeId: original.id,
  });
  check(
    priced.status === 201 && priced.body.quotedPrice === 15000,
    'a job takes the device-specific price when no quote is typed, and stores it',
    priced.body,
  );
  const low = await call('POST', '/jobs', {
    ...jobBase,
    deviceId: a.body.id,
    repairTypeId: screen.body.id,
    subTypeId: original.id,
    quotedPrice: 14000,
  });
  check(low.status === 409, 'a quote below the device’s price is refused', low.body);
  const blank = await call('POST', '/jobs', {
    ...jobBase,
    deviceId: a.body.id,
    repairTypeId: screen.body.id,
    subTypeId: oem.id,
  });
  check(blank.status === 400, 'a repair the device does not offer cannot be picked', blank.body);
  const diagJob = await call('POST', '/jobs', {
    ...jobBase,
    deviceId: a.body.id,
    repairTypeId: diag.body.id,
    subTypeId: null,
  });
  check(
    diagJob.status === 201 && diagJob.body.quotedPrice === 2000,
    'a diagnosis job takes the flat price',
  );

  // The job keeps the price it was created with: raise the device's price, the job still moves.
  await call('PUT', `/admin/devices/${a.body.id}`, {
    name: a.body.name,
    brand: 'apple',
    isActive: true,
    prices: aAfter.map((p) => (p.subTypeId === original.id ? { ...p, price: 20000 } : p)),
  });
  const moved = await call('POST', `/jobs/${priced.body.id}/status`, { status: 'in_progress' });
  check(
    moved.status === 200,
    'raising the price later does not stop an existing job moving on',
    moved.body,
  );
  const kept = await call('GET', `/jobs/${priced.body.id}`);
  check(kept.body?.quotedPrice === 15000, 'and its recorded price is unchanged');

  console.log('Deleting a sub-type is a soft delete');
  const del = await call('DELETE', `/admin/repair-sub-types/${premium.body.id}`);
  check(del.status === 204, 'a sub-type can be deleted');
  const offersAfter = (await call('GET', `/repair/offers?deviceId=${a.body.id}`)).body as {
    subTypeId: string | null;
  }[];
  check(
    !offersAfter.some((o) => o.subTypeId === premium.body.id),
    'it stops being offered on every device at once',
  );
  const publicList = (await call('GET', '/repair/sub-types')).body as { id: string }[];
  check(!publicList.some((s) => s.id === premium.body.id), 'and leaves the public list');

  // Cleanup: switch the test devices and repairs off (soft delete, like everything here).
  for (const d of [a.body.id, b.body.id]) await call('DELETE', `/admin/devices/${d}`);
  for (const r of [screen.body.id, diag.body.id]) await call('DELETE', `/admin/repair-types/${r}`);
  await call('POST', `/jobs/${priced.body.id}/status`, {
    status: 'cancelled',
    cancellationReason: 'E2E cleanup',
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
