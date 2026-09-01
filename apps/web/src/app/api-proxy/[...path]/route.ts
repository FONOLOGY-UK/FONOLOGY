import type { NextRequest } from 'next/server';

/**
 * Same-origin relay for `apiFetch` (see http.adapter.ts and same-site.ts).
 * Infrastructure, not a business-data shortcut — HARD RULE #2 ("business
 * data flows through the DataAdapter") is unaffected: every browser call
 * still goes component -> hook -> DataAdapter -> apiFetch, exactly as
 * before. This route is a transparent pipe apiFetch is routed through only
 * when the real API is cross-site with this page (staging today); it knows
 * nothing about any endpoint's shape and never will.
 *
 * WHY THIS EXISTS (client-reported bug, staging): Safari's Intelligent
 * Tracking Prevention blocks cross-site cookies outright, including
 * `SameSite=None; Secure` ones — `fonology-web.onrender.com` calling
 * `fonology-api.onrender.com` is cross-site because `onrender.com` is
 * itself on the Public Suffix List (see apps/api/src/lib/cookies.ts).
 * Staff login, and every other authenticated flow, silently failed in
 * Safari while working fine in Chrome. Routing browser calls through this
 * app's own origin instead makes them same-origin — no cross-site cookie
 * question for Safari, or anyone else, to enforce.
 *
 * Once `api.fonology.co.uk` exists (production), `same-site.ts`'s check
 * will find the API same-site with the page and `apiFetch` stops using
 * this route entirely — no code change needed there or here. This route
 * still exists in that world, just unused by the app's own client; that's
 * fine, it forwards to the same place a direct call would have gone.
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
 * Real client IP for the rate limiter — see apps/api/src/lib/clientIp.ts
 * for the full reasoning on why this can't just be "let X-Forwarded-For
 * accumulate through the extra hop and bump trust proxy's count instead".
 * `x-forwarded-for` on the request THIS route handler receives already has
 * exactly the two entries the API's `trust proxy: 2` expects (Cloudflare +
 * Render already sat in front of this app too) — take the first (leftmost,
 * real client) entry now, before any further hop can be added to the chain.
 */
function realClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || null;
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
