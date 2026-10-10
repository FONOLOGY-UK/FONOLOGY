import type { NextRequest } from 'next/server';

/**
 * Same-origin relay for `apiFetch` (see http.adapter.ts and same-site.ts). Infrastructure, not a
 * business-data shortcut: every browser call still goes component -> hook -> DataAdapter -> apiFetch.
 * This route is a transparent pipe, used only when the API is cross-site with the page (e.g. a staging
 * deployment on a multi-tenant domain). Safari's Intelligent Tracking Prevention blocks cross-site
 * cookies outright, even `SameSite=None; Secure`, so sign-in would silently fail there; relaying
 * through this app's own origin makes the calls same-origin. It knows nothing about any endpoint's
 * shape.
 *
 * In production (`fonology.co.uk` calling `api.fonology.co.uk`, same-site) `apiFetch` calls the API
 * directly and never uses this route.
 *
 * NOT used by:
 *  - Server Components / server-only code (shop-details.ts) — those call
 *    the real API directly; there is no browser, so no cookie/SameSite
 *    question for them either.
 *  - Stripe's webhook — Stripe posts straight to the API, never through
 *    the web app, and always has.
 *  - apps/print-agent — a separate deployable, authenticates with its own
 *    bearer token, never touches cookies or this app at all.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

// Headers that describe THIS hop, not the request being forwarded — letting
// them through would either be wrong (a stale Host/Content-Length) or
// redundant (`fetch` sets its own Connection handling).
const HOP_BY_HOP_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length']);

/**
 * Real client IP for the API's rate limiter — see apps/api/src/lib/clientIp.ts. The first-hop address is
 * read here, on the request this handler received, before the relay adds a hop of its own.
 */
function realClientIp(req: NextRequest): string | null {
  // A client can put anything at the FRONT of X-Forwarded-For; only the entries the platform's own proxies
  // appended (at the BACK) are trustworthy. TRUST_PROXY_HOPS is how many such proxies sit in front of this
  // app (1 behind Traefik alone, 2 with Cloudflare too) - the same variable the API uses, so the two agree.
  const hops = Math.max(1, Number(process.env.TRUST_PROXY_HOPS ?? '1') || 1);
  const entries = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  return entries[entries.length - hops] ?? entries[0] ?? null;
}

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  if (!API_ORIGIN) {
    return Response.json({ error: 'API base URL is not configured.' }, { status: 500 });
  }

  const search = req.nextUrl.search;
  const destination = `${API_ORIGIN}/${path.map(encodeURIComponent).join('/')}${search}`;

  const outgoingHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_REQUEST_HEADERS.has(key.toLowerCase())) outgoingHeaders.set(key, value);
  });

  // Never relay these two from the caller: they carry the trust, so only this route may set them.
  outgoingHeaders.delete('x-internal-proxy-secret');
  outgoingHeaders.delete('x-fonology-client-ip');

  const secret = process.env.INTERNAL_PROXY_SECRET;
  if (secret) {
    outgoingHeaders.set('x-internal-proxy-secret', secret);
    const ip = realClientIp(req);
    if (ip) outgoingHeaders.set('x-fonology-client-ip', ip);
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  const upstream = await fetch(destination, {
    method: req.method,
    headers: outgoingHeaders,
    // Stream straight through — this is what keeps a multipart product-image
    // or buy-in-form upload byte-for-byte identical to what the browser
    // sent. Parsing and reconstructing the body here would risk a subtly
    // different multipart boundary/encoding; piping the raw stream avoids
    // the question entirely.
    body: hasBody ? req.body : undefined,
    // Required by Node's fetch whenever `body` is a ReadableStream.
    ...(hasBody ? { duplex: 'half' } : {}),
    redirect: 'manual',
  } as RequestInit & { duplex: 'half' });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  // `Headers.set`/the Headers constructor collapse repeated Set-Cookie into
  // one combined value — wrong for multiple cookies (login sets three).
  // `getSetCookie()` (Node's fetch, available since the Node 20 this repo
  // already requires) is the one API that keeps them as separate entries.
  responseHeaders.delete('set-cookie');
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

type RouteParams = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { path } = await params;
  return proxy(req, path);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
