#!/usr/bin/env node
/**
 * Post-deploy smoke test for a LIVE (or local) Fonology deployment. Reads nothing secret, writes
 * nothing — it only makes the requests any visitor could make.
 *
 *   WEB_URL=https://fonology.co.uk API_URL=https://api.fonology.co.uk \
 *   WWW_URL=https://www.fonology.co.uk STORAGE_URL=https://product-images.web.fonology.co.uk \
 *   S3_URL=https://s3.fonology.co.uk node scripts/go-live-check.mjs
 *
 * Defaults to the local dev servers (:3000 / :4000), where the TLS-only checks are skipped.
 * Exit code 1 if any FAIL. WARN means "look at this before opening", not "broken".
 *
 * The rate-limit check is the important one: it proves a visitor cannot dodge the login limiter by
 * forging X-Forwarded-For, i.e. that TRUST_PROXY_HOPS matches the real proxy chain. It runs LAST
 * because it leaves this machine's address locked out of staff sign-in for a while.
 *
 * Against a server with a private CA (the local rehearsal, scripts/rehearsal.mjs), set
 * NODE_EXTRA_CA_CERTS to that CA's root certificate.
 */
import tls from 'node:tls';

const WEB = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const STORAGE = process.env.STORAGE_URL?.replace(/\/$/, '');
const WWW = process.env.WWW_URL?.replace(/\/$/, '');
const S3 = process.env.S3_URL?.replace(/\/$/, '');
const secure = WEB.startsWith('https://');
// Warn when a certificate has fewer days left than this. Let's Encrypt renews at 30 days left.
const CERT_MIN_DAYS = Number(process.env.CERT_MIN_DAYS ?? 14);

const results = [];
const record = (level, name, detail = '') => {
  results.push({ level, name });
  const tag = {
    PASS: '\x1b[32mPASS\x1b[0m',
    FAIL: '\x1b[31mFAIL\x1b[0m',
    WARN: '\x1b[33mWARN\x1b[0m',
    INFO: '\x1b[36mINFO\x1b[0m',
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

/** Days until the certificate served for `url` expires; rejects if it does not verify. */
function certDaysLeft(url) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: hostname, port: Number(port || 443), servername: hostname, timeout: 15_000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!socket.authorized) return reject(new Error(String(socket.authorizationError)));
        resolve(Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000));
      },
    );
    socket.on('error', reject);
    socket.on('timeout', () => socket.destroy(new Error('timeout')));
  });
}

let products = null;

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

await section('Certificates', async () => {
  if (!secure) return record('SKIP', 'certificate checks (WEB_URL is not https)');
  for (const url of [WEB, API, WWW, STORAGE, S3].filter(Boolean)) {
    try {
      const days = await certDaysLeft(url);
      if (days < CERT_MIN_DAYS) record('WARN', `${url} certificate expires in ${days} days`);
      else record('PASS', `${url} certificate is valid (${days} days left)`);
    } catch (e) {
      record('FAIL', `${url} certificate is valid`, e.message);
    }
  }
});

await section('HTTPS and headers', async () => {
  const a = await get(`${API}/health`);
  check(
    !a.headers.get('x-powered-by'),
    'api does not advertise Express',
    `x-powered-by: ${a.headers.get('x-powered-by')}`,
  );
  check(a.headers.get('x-content-type-options') === 'nosniff', 'api sends nosniff', 'missing');
  check(a.headers.get('referrer-policy') === 'no-referrer', 'api sends no-referrer', 'missing');
  if (!secure) return record('SKIP', 'TLS-only header checks (WEB_URL is not https)');
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
  check(!!w.headers.get('x-frame-options'), 'web sends X-Frame-Options', 'header missing');
  check(!!w.headers.get('permissions-policy'), 'web sends Permissions-Policy', 'header missing');
  check(
    !w.headers.get('x-powered-by'),
    'web does not advertise its framework',
    `x-powered-by: ${w.headers.get('x-powered-by')}`,
  );
  for (const [label, base] of [
    ['web', WEB],
    ['api', API],
  ]) {
    const http = await get(base.replace('https://', 'http://')).catch(() => null);
    check(
      !http ||
        (http.status >= 300 &&
          http.status < 400 &&
          (http.headers.get('location') ?? '').startsWith('https://')),
      `${label}: http redirects to https`,
      `got ${http?.status}`,
    );
  }
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

// NEXT_PUBLIC_* and STORAGE_PUBLIC_URL are inlined when the web image is BUILT. In Coolify a value
// set as a runtime-only variable bakes in as undefined — the site then calls nowhere. The CSP
// header is computed from the same variables at build time, so it shows what was baked in.
await section('Web build variables were baked in', async () => {
  const w = await get(WEB);
  const csp = w.headers.get('content-security-policy-report-only') ?? '';
  const directive = (name) =>
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `)) ?? '';
  check(!!csp, 'web sends a Content-Security-Policy-Report-Only header', 'header missing');
  check(
    directive('connect-src').includes(new URL(API).origin),
    'the web build knows the API address (NEXT_PUBLIC_API_BASE_URL)',
    `connect-src: ${directive('connect-src') || '(none)'}`,
  );
  if (STORAGE)
    check(
      directive('img-src').includes(new URL(STORAGE).origin),
      'the web build knows the photo host (STORAGE_PUBLIC_URL)',
      `img-src: ${directive('img-src') || '(none)'}`,
    );
  if (!/localhost|127\.0\.0\.1/.test(API)) {
    const html = await w.text();
    check(
      !/localhost:4000|127\.0\.0\.1/.test(html),
      'the home page carries no localhost API address',
      'found localhost / 127.0.0.1 in the HTML',
    );
  }
});

await section('Browser access (CORS, CSRF)', async () => {
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
  // Refused by requireTrustedOrigin before any session lookup — nothing is signed out or written.
  const forged = await get(`${API}/auth/signout`, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      Cookie: 'fnl_session=go-live-check',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  check(
    forged.status === 403,
    'a cookie-carrying write from a foreign origin is refused (CSRF, 403)',
    `got ${forged.status}`,
  );
});

await section('Pages render', async () => {
  const pages = [
    '/',
    '/shop',
    '/repair',
    '/sell',
    '/track',
    '/cart',
    '/checkout',
    '/login',
    '/register',
    '/staff-login',
    '/forgot-password',
    '/admin',
    '/pos',
  ];
  for (const path of pages) {
    const r = await get(`${WEB}${path}`);
    check(r.status < 400, `${path} renders`, `got ${r.status}`);
  }
  const missing = await get(`${WEB}/no-such-page-go-live-check`);
  check(missing.status === 404, 'an unknown page is a 404, not an error', `got ${missing.status}`);
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
  products = await (await get(`${API}/products`)).json().catch(() => null);
  if (!Array.isArray(products)) record('FAIL', 'GET /products returns a list');
  else if (products.length === 0)
    record('WARN', 'the shop has NO products yet', 'the storefront will say "Nothing here yet"');
  else record('PASS', `the shop lists ${products.length} products`);

  // The product page is rendered on every view from the live API (revalidate = 0), so this proves
  // the web container can reach the API server-side, not just the browser.
  const first = Array.isArray(products) ? products[0] : null;
  if (first) {
    const r = await get(`${WEB}/shop/${encodeURIComponent(first.slug)}`);
    const html = r.status === 200 ? await r.text() : '';
    const name = String(first.name).replace(/&/g, '&amp;');
    check(
      r.status === 200 && html.includes(name),
      `a product page renders from the API (/shop/${first.slug})`,
      `got ${r.status}${r.status === 200 ? ', product name not in the page' : ''}`,
    );
  } else record('SKIP', 'product page (no products)');
});

await section('Product photos', async () => {
  if (STORAGE) {
    const r = await get(`${STORAGE}/does-not-exist.jpg`);
    check(
      [403, 404].includes(r.status),
      'the public photo host answers (404 for a missing file)',
      `got ${r.status}`,
    );
  } else record('SKIP', 'photo host (set STORAGE_URL to check it)');
  const withImage = Array.isArray(products) ? products.find((p) => p.images?.length) : null;
  if (!withImage) return record('SKIP', 'a real photo (no product has one)');
  const src = withImage.images[0];
  const raw = await get(src);
  check(
    raw.status === 200 && (raw.headers.get('content-type') ?? '').startsWith('image/'),
    'a product photo loads from the photo host',
    `got ${raw.status} ${raw.headers.get('content-type')}`,
  );
  const resized = await get(`${WEB}/_next/image?url=${encodeURIComponent(src)}&w=64&q=75`);
  check(
    resized.status === 200,
    'the web app can resize that photo (next/image allows the host)',
    `got ${resized.status}`,
  );
});

await section('Legal and info pages', async () => {
  const placeholder = /content to be finalised|lorem ipsum/i;
  const load = (path) =>
    get(`${WEB}${path}`).then(
      (r) => (r.status === 200 ? r.text() : null),
      () => null,
    );
  for (const path of ['/terms', '/privacy', '/returns-policy', '/shipping', '/cookies']) {
    const page = await load(path);
    if (page === null) record('FAIL', `${path} loads`);
    else if (placeholder.test(page)) record('WARN', `${path} still shows placeholder text`);
    else record('PASS', `${path} has its real text`);
  }
  for (const path of ['/about', '/faq', '/contact']) {
    const page = await load(path);
    if (page === null) record('FAIL', `${path} loads`);
    else if (placeholder.test(page))
      record('WARN', `${path} still shows placeholder text`, 'the shop supplies this copy');
    else record('PASS', `${path} has its real text`);
  }
});

await section('Sign-in options', async () => {
  const p = await (await get(`${API}/auth/providers`)).json().catch(() => null);
  if (!p) return record('FAIL', 'GET /auth/providers answers');
  record('INFO', `sign-in providers: ${JSON.stringify(p)}`);
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

const count = (level) => results.filter((r) => r.level === level).length;
console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('WARN')} warnings`);
process.exit(count('FAIL') ? 1 : 0);
