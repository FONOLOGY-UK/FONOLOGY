/**
 * Every `rpc(name, { args }, { returnsSet })` call in src/, checked against the
 * real functions in pg_proc: the function exists, every argument name is one
 * it takes, every argument without a default is supplied, and the call's
 * returnsSet matches whether the function returns a set. TypeScript cannot
 * see any of that — those are strings.
 *
 *   pnpm --filter @fonology/api exec tsx scripts/rpc-audit.ts
 *
 * RPC_AUDIT_DATABASE_URL defaults to the local stack. Exits 1 on any problem.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve('src');
const files: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    const p = path.join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
};
walk(root);

type Call = { file: string; line: number; name: string; args: string[]; returnsSet: boolean };
const calls: Call[] = [];
const NL = String.fromCharCode(10);

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const re = /\brpc(?:<[^()]*?>)?\(\s*'([a-z_]+)'/g;
  for (const m of src.matchAll(re)) {
    // Walk the call's own parentheses, skipping comments and string contents.
    let i = m.index + m[0].length;
    let depth = 1;
    let body = '';
    while (depth > 0 && i < src.length) {
      const c = src[i]!;
      if (c === '/' && src[i + 1] === '/') {
        i = src.indexOf(NL, i);
        continue;
      }
      if (c === "'" || c === '`') {
        i++;
        while (src[i] !== c) i++;
        i++;
        body += '""';
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth > 0) body += c;
      i++;
    }
    // Top-level { ... } objects inside the call: [args, options].
    const objs: string[] = [];
    let d = 0;
    let cur = '';
    for (const ch of body) {
      if (ch === '{') {
        if (d === 0) cur = '';
        d++;
      }
      if (d > 0) cur += ch;
      if (ch === '}') {
        d--;
        if (d === 0) objs.push(cur);
      }
    }
    const argsSrc = objs[0] ?? '';
    const args = [...argsSrc.matchAll(/(p_[a-z0-9_]+|\bts)\s*:/g)].map((a) => a[1]!);
    calls.push({
      file: path.relative(root, file),
      line: src.slice(0, m.index).split(NL).length,
      name: m[1]!,
      args,
      returnsSet: /returnsSet:\s*true/.test(objs[1] ?? ''),
    });
  }
}

const db = new pg.Client(
  process.env.RPC_AUDIT_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:55432/fonology',
);
await db.connect();
const { rows: procs } = await db.query<{
  proname: string;
  args: string[] | null;
  nargs: number;
  ndefaults: number;
  retset: boolean;
  result: string;
}>(`select p.proname, p.proargnames as args, p.pronargs as nargs, p.pronargdefaults as ndefaults,
          p.proretset as retset, pg_get_function_result(p.oid) as result
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'`);

let problems = 0;
for (const c of calls) {
  const candidates = procs.filter((p) => p.proname === c.name);
  const where = `${c.file}:${c.line} ${c.name}(${c.args.join(', ')})`;
  if (candidates.length === 0) {
    console.log(`MISSING   ${where}`);
    problems++;
    continue;
  }
  const fits = candidates.filter((p) => {
    const inArgs = (p.args ?? []).slice(0, p.nargs);
    const required = inArgs.slice(0, p.nargs - p.ndefaults);
    return c.args.every((a) => inArgs.includes(a)) && required.every((r) => c.args.includes(r));
  });
  if (fits.length === 0) {
    const sigs = candidates.map((p) => (p.args ?? []).slice(0, p.nargs).join(', ')).join(' | ');
    console.log(`ARGS      ${where}  — function takes (${sigs})`);
    problems++;
    continue;
  }
  const retset = fits.some((p) => p.retset);
  if (retset !== c.returnsSet) {
    console.log(`SHAPE     ${where}  — returns ${fits[0]!.result}, returnsSet=${c.returnsSet}`);
    problems++;
    continue;
  }
  console.log(`ok        ${where}  -> ${fits[0]!.result}`);
}
console.log(`\n${calls.length} rpc calls, ${problems} problem(s)`);
await db.end();
if (problems > 0) process.exit(1);
