#!/usr/bin/env node
// Local dev stack (docker-compose.dev.yml): Postgres 17 + pgTAP, Garage, Mailpit.
//   node scripts/dev-stack.mjs up | down | reset | status
//
// `up` is idempotent: it starts the containers, waits for their health checks,
// then gives Garage its single-node layout and the fixed dev access key below
// (Garage refuses all S3 traffic until a layout is applied). Buckets are made
// by apps/api/scripts/storage-setup.ts, not here.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = ['compose', '-f', path.join(root, 'docker-compose.dev.yml')];

// LOCAL DEVELOPMENT ONLY — the same values are in apps/api/.env.example.
const DEV_KEY_NAME = 'fonology-dev';
const DEV_KEY_ID = 'GK0f0e1a2b3c4d5e6f70819a2b';
const DEV_KEY_SECRET = '9b1e4c7a2d5f8e0b3a6c9d2f5e8b1a4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a';

function docker(args, { capture = false, allowFail = false } = {}) {
  const r = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) {
    if (capture) process.stderr.write(r.stderr ?? '');
    throw new Error(`docker ${args.join(' ')} exited with ${r.status}`);
  }
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

const garage = (args, opts) =>
  docker([...compose, 'exec', '-T', 'garage', '/garage', ...args], opts);

function initGarage() {
  const layout = garage(['layout', 'show'], { capture: true }).out;
  if (/Current cluster layout version:\s*0\b/.test(layout)) {
    const nodeId = garage(['node', 'id', '-q'], { capture: true }).out.split('@')[0];
    garage(['layout', 'assign', '-z', 'dc1', '-c', '1G', nodeId], { capture: true });
    garage(['layout', 'apply', '--version', '1'], { capture: true });
    console.log('[garage] single-node layout applied');
  }
  const key = garage(['key', 'info', DEV_KEY_NAME], { capture: true, allowFail: true });
  if (!key.ok) {
    garage(['key', 'import', '--yes', '-n', DEV_KEY_NAME, DEV_KEY_ID, DEV_KEY_SECRET], {
      capture: true,
    });
    console.log(`[garage] dev key ${DEV_KEY_ID} imported`);
  }
  garage(['key', 'allow', '--create-bucket', DEV_KEY_NAME], { capture: true });
}

const cmd = process.argv[2] ?? 'up';
if (cmd === 'up') {
  docker([...compose, 'up', '-d', '--build', '--wait']);
  initGarage();
  console.log(`
Local stack is up:
  Postgres  postgres://postgres:postgres@localhost:55432/fonology
  S3        http://localhost:3900  (key ${DEV_KEY_ID})
  Public    http://<bucket>.web.garage.localhost:3902
  Mailpit   SMTP localhost:1025 · inbox http://localhost:8025`);
} else if (cmd === 'down') {
  docker([...compose, 'down']);
} else if (cmd === 'reset') {
  docker([...compose, 'down', '-v']);
} else if (cmd === 'status') {
  docker([...compose, 'ps']);
} else {
  console.error('usage: node scripts/dev-stack.mjs up|down|reset|status');
  process.exit(1);
}
