#!/usr/bin/env node
// Stage-2 timing harness. Signs in as the seeded owner on a LOCAL API (run it
// against the fonology_bench database — scripts/bench/seed-bench.sql) and times
// the hot endpoints: 3 warm-ups, then N timed runs, p50/p95/max in ms and the
// response size. Usage:
//   node scripts/bench/api-timings.mjs [out.json] [--n=20] [--api=http://localhost:4000]
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const API = opt('api', 'http://localhost:4000');
const N = Number(opt('n', 20));
const out = args.find((a) => !a.startsWith('--'));
if (!/^http:\/\/localhost[:/]/.test(API)) throw new Error('Local API only.');

const cookies = new Map();
const keep = (res) => {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
};
const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

const signin = await fetch(`${API}/staff/signin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'owner@fonology.test', password: 'Test1234!' }),
});
keep(signin);
if (signin.status !== 200) throw new Error(`owner sign-in failed: ${signin.status}`);

const slug = 'bench-1';
const day = (ago) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
const range = (days) => `from=${day(days)}&to=${day(0)}`;
const endpoints = [
  ['public', '/products'],
  ['public', '/categories'],
  ['public', `/products/${slug}`],
  ['public', '/shop'],
  ['public', '/repair/devices'],
  ['staff', '/auth/session'],
  ['staff', '/admin/products'],
  ['staff', '/admin/inventory/summary'],
  ['staff', '/admin/product-folders'],
  ['staff', '/admin/promotions'],
  ['staff', '/admin/settings'],
  ['staff', `/reports/transactions?${range(120)}`],
  ['staff', `/reports/transactions?${range(7)}`],
  ['staff', `/reports/analytics?${range(120)}`],
  ['staff', `/reports/analytics?${range(30)}`],
  ['staff', '/orders'],
  ['staff', '/repair/bookings'],
  ['staff', '/pos/today'],
  ['staff', '/pos/today/report'],
  ['staff', '/pos/refunds'],
  ['staff', '/pos/cash'],
  ['staff', '/pos/day-close'],
  ['staff', '/pos/favourites'],
  ['staff', '/pos/folders'],
];

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const results = [];
for (const [kind, path] of endpoints) {
  const times = [];
  let status = 0;
  let bytes = 0;
  for (let i = 0; i < N + 3; i++) {
    const t0 = performance.now();
    const res = await fetch(`${API}${path}`, {
      headers: kind === 'staff' ? { Cookie: cookie() } : {},
    });
    const body = await res.arrayBuffer();
    const ms = performance.now() - t0;
    status = res.status;
    bytes = body.byteLength;
    if (i >= 3) times.push(ms);
  }
  times.sort((a, b) => a - b);
  results.push({
    path,
    status,
    bytes,
    p50: +pct(times, 50).toFixed(1),
    p95: +pct(times, 95).toFixed(1),
    max: +times.at(-1).toFixed(1),
  });
}

console.log(
  'path'.padEnd(30),
  'status',
  'bytes'.padStart(9),
  'p50'.padStart(8),
  'p95'.padStart(8),
  'max'.padStart(8),
);
for (const r of results)
  console.log(
    r.path.padEnd(30),
    String(r.status).padEnd(6),
    String(r.bytes).padStart(9),
    String(r.p50).padStart(8),
    String(r.p95).padStart(8),
    String(r.max).padStart(8),
  );
if (out)
  writeFileSync(
    out,
    JSON.stringify({ at: new Date().toISOString(), api: API, n: N, results }, null, 2),
  );
