#!/usr/bin/env node
// First-load JS per App Router page, from a finished `next build` (apps/web/.next).
// Next's own route table is printed only when the whole build succeeds, which it
// does not on Windows (standalone symlinks need privileges) — this reads the same
// numbers from app-build-manifest.json: every JS chunk a page loads, gzipped.
// Usage: node scripts/bench/bundle-sizes.mjs [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const next = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/web/.next');
const manifest = JSON.parse(readFileSync(path.join(next, 'app-build-manifest.json'), 'utf8'));
const cache = new Map();
const gz = (f) => {
  if (!cache.has(f)) cache.set(f, gzipSync(readFileSync(path.join(next, f))).length);
  return cache.get(f);
};

const rows = Object.entries(manifest.pages)
  .filter(([page]) => page.endsWith('/page'))
  .map(([page, files]) => {
    const js = [...new Set(files)].filter((f) => f.endsWith('.js'));
    return {
      route: page.replace(/\/page$/, '') || '/',
      chunks: js.length,
      kb: +(js.reduce((n, f) => n + gz(f), 0) / 1024).toFixed(1),
    };
  })
  .sort((a, b) => b.kb - a.kb);

for (const r of rows)
  console.log(r.route.padEnd(50), String(r.chunks).padStart(4), `${r.kb} kB`.padStart(10));
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
