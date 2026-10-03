#!/usr/bin/env node
// Lighthouse (mobile, performance only) on the pages stage 2 cares about, 3 runs
// each, median reported. Needs a production web build on :3000 and the bench API
// on :4000; the till is signed in with the seeded owner's session cookie.
//   node scripts/bench/lighthouse.mjs [out.json] [page]   CHROME_PATH must be set
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WEB = 'http://localhost:3000';
const API = 'http://localhost:4000';
const RUNS = 3;

const signin = await fetch(`${API}/staff/signin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'owner@fonology.test', password: 'Test1234!' }),
});
const cookie = (signin.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ');
if (signin.status !== 200 || !cookie) throw new Error('sign-in failed');

const pages = [
  ['home', '/', false],
  ['shop', '/shop', false],
  ['pdp', '/shop/bench-1', false],
  ['till', '/pos', true],
];
const metrics = {
  score: null,
  fcp: 'first-contentful-paint',
  lcp: 'largest-contentful-paint',
  tbt: 'total-blocking-time',
  cls: 'cumulative-layout-shift',
  si: 'speed-index',
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-'));
const results = {};

const only = process.argv[3];
for (const [name, url, authed] of pages) {
  if (only && name !== only) continue;
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const out = path.join(dir, `${name}-${i}.json`);
    const args = [
      '--yes',
      'lighthouse@12',
      WEB + url,
      '--only-categories=performance',
      '--output=json',
      `--output-path=${out}`,
      '--chrome-flags=--headless=new --no-sandbox',
      '--quiet',
    ];
    if (authed) {
      const headers = path.join(dir, 'headers.json');
      writeFileSync(headers, JSON.stringify({ Cookie: cookie }));
      args.push(`--extra-headers=${headers}`);
    }
    execFileSync('npx', args, {
      stdio: 'ignore',
      shell: true,
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });
    const r = JSON.parse(readFileSync(out, 'utf8'));
    runs.push({
      score: Math.round(r.categories.performance.score * 100),
      ...Object.fromEntries(
        Object.entries(metrics)
          .filter(([k]) => k !== 'score')
          .map(([k, id]) => [k, r.audits[id].numericValue]),
      ),
      finalUrl: r.finalUrl,
    });
  }
  const m = Object.fromEntries(
    Object.keys(runs[0])
      .filter((k) => k !== 'finalUrl')
      .map((k) => [k, +median(runs.map((r) => r[k])).toFixed(k === 'cls' ? 3 : 0)]),
  );
  results[name] = { ...m, finalUrl: runs[0].finalUrl };
  console.log(name.padEnd(5), JSON.stringify(results[name]));
}
if (process.argv[2])
  writeFileSync(
    process.argv[2],
    JSON.stringify({ at: new Date().toISOString(), runs: RUNS, results }, null, 2),
  );
