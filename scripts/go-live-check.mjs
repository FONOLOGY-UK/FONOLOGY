#!/usr/bin/env node
/**
 * Post-deploy smoke test for a LIVE (or local) Fonology deployment. Reads nothing secret, writes
 * nothing — it only makes the requests any visitor could make.
 *
 *   WEB_URL=https://fonology.co.uk API_URL=https://api.fonology.co.uk \
 *   STORAGE_URL=https://product-images.web.fonology.co.uk node scripts/go-live-check.mjs
 *
 * Defaults to the local dev servers (:3000 / :4000), where the TLS-only checks are skipped.
 * Exit code 1 if any FAIL. WARN means "look at this before opening", not "broken".
 *
 * The rate-limit check is the important one: it proves a visitor cannot dodge the login limiter by
 * forging X-Forwarded-For, i.e. that TRUST_PROXY_HOPS matches the real proxy chain.
 */
const WEB = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const STORAGE = process.env.STORAGE_URL?.replace(/\/$/, '');
const WWW = process.env.WWW_URL?.replace(/\/$/, '');
const S3 = process.env.S3_URL?.replace(/\/$/, '');
const secure = WEB.startsWith('https://');

const results = [];
const record = (level, name, detail = '') => {
  results.push({ level, name });
  const tag = {
    PASS: '\x1b[32mPASS\x1b[0m',
    FAIL: '\x1b[31mFAIL\x1b[0m',
    WARN: '\x1b[33mWARN\x1b[0m',
    SKIP: 'SKIP',
  }[level];
  console.log(`  ${tag}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const check = (ok, name, detail) => record(ok ? 'PASS' : 'FAIL', name, ok ? '' : detail);
const get = (url, init = {}) =>
  fetch(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(20_000) });

async function section(title, fn) {
  console.log(`\n${title}`);
  try {
    await fn();
  } catch (e) {
    record('FAIL', `${title} — could not run`, e.cause?.code ?? e.message);
  }
}

await section('Services answer', async () => {
  const w = await get(`${WEB}/api/health`);
  check(w.status === 200, 'web /api/health is 200', `got ${w.status}`);
  const a = await get(`${API}/health`);
  check(a.status === 200, 'api /health is 200', `got ${a.status}`);
  const r = await get(`${API}/health/ready`);
  const body = await r.json().catch(() => ({}));
  check(
    r.status === 200 && body.db === true,
    'api /health/ready reaches the database',
    `got ${r.status} ${JSON.stringify(body)}`,
  );
});

await section('HTTPS and headers', async () => {
  if (!secure) return record('SKIP', 'TLS checks (WEB_URL is not https)');
  const w = await get(WEB);
  check(
    /max-age=\d+/.test(w.headers.get('strict-transport-security') ?? ''),
    'web sends Strict-Transport-Security',
    'header missing',
  );
  check(
    w.headers.get('x-content-type-options') === 'nosniff',
    'web sends X-Content-Type-Options',
    'header missing',
  );
  check(!!w.headers.get('referrer-policy'), 'web sends Referrer-Policy', 'header missing');
  check(
    !w.headers.get('x-powered-by'),
    'web does not advertise its framework',
    `x-powered-by: ${w.headers.get('x-powered-by')}`,
  );
  const a = await get(`${API}/health`);
  check(
    !a.headers.get('x-powered-by'),
    'api does not advertise Express',
    `x-powered-by: ${a.headers.get('x-powered-by')}`,
  );
  const http = await get(WEB.replace('https://', 'http://')).catch(() => null);
  check(
    !http ||
      (http.status >= 300 &&
        http.status < 400 &&
        (http.headers.get('location') ?? '').startsWith('https://')),
    'http redirects to https',
    `got ${http?.status}`,
  );
  if (WWW) {
    const www = await get(WWW);
    const loc = www.headers.get('location') ?? '';
    check(
      www.status >= 300 && www.status < 400 && loc.startsWith(WEB),
      'www redirects to the main address',
      `got ${www.status} → ${loc}`,
    );
  } else record('SKIP', 'www redirect (set WWW_URL to check it)');
});

await section('Browser access (CORS)', async () => {
  const ok = await get(`${API}/shop`, {
    method: 'OPTIONS',
    headers: { Origin: WEB, 'Access-Control-Request-Method': 'GET' },
  });
  check(
    ok.headers.get('access-control-allow-origin') === WEB &&
      ok.headers.get('access-control-allow-credentials') === 'true',
    'the storefront origin may call the API with cookies',
    `allow-origin=${ok.headers.get('access-control-allow-origin')}`,
  );
  const bad = await get(`${API}/shop`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
  });
  check(
    !bad.headers.get('access-control-allow-origin'),
    'a foreign origin is NOT allowed',
    `allow-origin=${bad.headers.get('access-control-allow-origin')}`,
  );
});

await section('Shop content', async () => {
  const s = await (await get(`${API}/shop`)).json().catch(() => null);
  check(!!s, 'GET /shop returns the shop facts', 'no JSON');
  if (s) {
    const text = JSON.stringify(s);
    check(
      /thornliebank|glasgow/i.test(text),
      'shop settings carry the real address',
      'address looks unset',
    );
    check(
      !/localhost|example\.(com|invalid)/i.test(text),
      'shop settings have no placeholder values',
      text.slice(0, 120),
    );
  }
  const p = await (await get(`${API}/products`)).json().catch(() => null);
  if (!Array.isArray(p)) record('FAIL', 'GET /products returns a list');
  else if (p.length === 0)
    record('WARN', 'the shop has NO products yet', 'the storefront will say "Nothing here yet"');
  else record('PASS', `the shop lists ${p.length} products`);
  const page = await get(`${WEB}/terms`).then(
    (r) => r.text(),
    () => null,
  );
  if (page === null) record('WARN', 'could not load /terms to check the legal pages');
  else if (/content to be finalised|lorem ipsum/i.test(page))
    record('WARN', 'legal pages still show placeholder text', '/terms');
  else record('PASS', 'legal pages are not placeholders');
});

await section('Payments', async () => {
  const unsigned = await get(`${API}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  check(
    unsigned.status === 400,
    'the Stripe webhook is reachable and rejects an unsigned call (400)',
    `got ${unsigned.status} (404 = not routed, 503 = secret not set)`,
  );
});

await section('Login rate limit (proves TRUST_PROXY_HOPS is right)', async () => {
  const attempt = (headers) =>
    get(`${API}/staff/signin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ email: 'nobody@go-live-check.invalid', password: 'wrong-password' }),
    });
  // 1. Plain repeated attempts from this one client must eventually be refused.
  let limited = false;
  for (let i = 0; i < 40 && !limited; i += 1) limited = (await attempt({})).status === 429;
  check(
    limited,
    'repeated bad logins from one address are rate-limited (429)',
    'never limited in 40 tries',
  );
  // 2. Forging a fresh X-Forwarded-For each time must NOT reset the limit.
  let stillLimited = 0;
  for (let i = 0; i < 6; i += 1) {
    const r = await attempt({ 'X-Forwarded-For': `203.0.113.${10 + i}` });
    if (r.status === 429) stillLimited += 1;
  }
  check(
    !limited || stillLimited >= 5,
    'a forged X-Forwarded-For does not dodge the limit',
    `only ${stillLimited}/6 were still refused — TRUST_PROXY_HOPS is too high`,
  );
});

if (STORAGE) {
  await section('Product photos', async () => {
    const r = await get(`${STORAGE}/does-not-exist.jpg`);
    check(
      [403, 404].includes(r.status),
      'the public photo host answers (404 for a missing file)',
      `got ${r.status}`,
    );
  });
} else record('SKIP', 'photo host (set STORAGE_URL to check it)');

if (S3) {
  await section('Private file storage', async () => {
    for (const bucket of ['id-documents', 'buy-in-forms']) {
      const r = await get(`${S3}/${bucket}/`);
      check(
        [401, 403, 404].includes(r.status),
        `anonymous access to ${bucket} is refused`,
        `got ${r.status}`,
      );
    }
  });
} else record('SKIP', 'private storage (set S3_URL to check it)');

const fails = results.filter((r) => r.level === 'FAIL').length;
const warns = results.filter((r) => r.level === 'WARN').length;
console.log(
  `\n${results.filter((r) => r.level === 'PASS').length} passed, ${fails} failed, ${warns} warnings`,
);
process.exit(fails ? 1 : 0);
