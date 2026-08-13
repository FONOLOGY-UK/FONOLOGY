import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

/**
 * Build the agent into ONE file, plus the PowerShell host script.
 * =========================================================================
 * WHY BUNDLE INSTEAD OF SHIPPING node_modules — found the hard way.
 *
 * The first working installer copied `dist/` and `node_modules/` onto the
 * machine and the agent died instantly with:
 *
 *     Cannot find package 'canvas-dither' imported from
 *     .../@point-of-sale/receipt-printer-encoder/dist/receipt-printer-encoder.mjs
 *
 * pnpm does not build a normal node_modules tree. Packages are symlinks into a
 * central store, and a package's own dependencies live beside it IN THAT
 * STORE, not under the package. Copying the folder copies the link targets and
 * loses everything they depend on. Nothing about this is visible in the
 * monorepo, where it all resolves perfectly — it only shows up once the files
 * are somewhere else, which in the normal course of events means on the shop's
 * till PC on install day.
 *
 * Bundling removes the entire question. The install becomes two files instead
 * of a tree of thousands, it is a few hundred kilobytes instead of tens of
 * megabytes, and there is no resolution left to go wrong on a machine nobody
 * can debug.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'dist');

fs.rmSync(outDir, { recursive: true, force: true });

const result = await esbuild.build({
  entryPoints: [path.join(root, 'src/index.ts')],
  outfile: path.join(outDir, 'index.js'),
  bundle: true,
  platform: 'node',
  // ESM because the source is ESM and `import.meta.url` is used to locate the
  // PowerShell script. Rewriting that to __dirname for a CJS build would mean
  // the dev and installed layouts resolved differently.
  format: 'esm',
  target: 'node20',
  // Node 20 is the floor in package.json; nothing here needs anything newer.
  sourcemap: true,
  // Kept readable on purpose. When this misbehaves in a shop, the stack trace
  // in the log should point at something a person can find.
  minify: false,
  metafile: true,
  logLevel: 'info',
});

/**
 * The host script must sit next to the bundle.
 *
 * Written to BOTH candidate locations because host.ts probes for it: `./`
 * matches the bundled layout, `./host/` matches the plain-tsc layout that
 * `pnpm dev` and a `tsc` build produce. Two small files beats a path that is
 * right in one mode and wrong in the other.
 */
for (const dest of [
  path.join(outDir, 'print-host.ps1'),
  path.join(outDir, 'host/print-host.ps1'),
]) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, 'src/host/print-host.ps1'), dest);
}

const bytes = fs.statSync(path.join(outDir, 'index.js')).size;
console.log(`[bundle] dist/index.js — ${(bytes / 1024).toFixed(0)} KB`);
console.log(`[bundle] dist/print-host.ps1, dist/host/print-host.ps1`);
void result;
