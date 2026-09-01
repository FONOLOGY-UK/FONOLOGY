import type { Request } from 'express';
import { config } from '../config.js';

/**
 * The IP every rate limiter in this app keys on. Normally just `req.ip`
 * (Express, via `trust proxy: 2` in server.ts — see that comment for the
 * real hop-by-hop reasoning behind that number).
 *
 * WHY THIS EXISTS — the Safari cookie fix (client-reported bug, staging)
 * Staging's cross-site topology (fonology-web.onrender.com calling
 * fonology-api.onrender.com) makes Safari's Intelligent Tracking Prevention
 * block the session cookie outright, breaking every login. The fix routes
 * browser calls through apps/web's own `/api-proxy/*` — same-origin from
 * the browser, so no cross-site cookie question exists for Safari to enforce.
 *
 * But that adds a real hop: browser -> Cloudflare -> Render (fonology-web) ->
 * Next's own server -> Cloudflare -> Render (fonology-api) -> here. The
 * X-Forwarded-For chain Cloudflare/Render append to on the way back OUT
 * through fonology-api's own edge is now two entries longer than the
 * `trust proxy: 2` hop count this app was built (and diagnosed live) against
 * — trusting it unchanged would silently land `req.ip` on the wrong entry
 * again, the exact bug class server.ts's comment already documents once.
 *
 * Rather than re-tune `trust proxy` for a hop count that's only true for
 * traffic arriving via the proxy (and wrong again for direct calls, once
 * production drops the proxy entirely — see same-site.ts on the web side),
 * the proxy route itself reads the REAL client IP off the ORIGINAL,
 * un-proxied request it received (before any extra hop exists) and passes
 * it through in a dedicated header, authenticated by a shared secret only
 * the two Render services know. This app trusts that header ONLY when the
 * secret matches; every other caller — including a browser hitting this API
 * directly — falls back to the normal `trust proxy`-derived `req.ip`,
 * unchanged from before this fix existed.
 *
 * `INTERNAL_PROXY_SECRET` unset (e.g. an environment that predates this
 * change) -> the header is never trusted, full stop -> this is exactly
 * `req.ip` as before. Nothing about the direct-call path changes.
 */
const PROXY_SECRET_HEADER = 'x-internal-proxy-secret';
const PROXY_CLIENT_IP_HEADER = 'x-fonology-client-ip';

export function clientIp(req: Request): string | undefined {
  if (config.internalProxySecret) {
    const secret = req.headers[PROXY_SECRET_HEADER];
    if (secret === config.internalProxySecret) {
      const forwarded = req.headers[PROXY_CLIENT_IP_HEADER];
      const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      if (ip) return ip;
    }
  }
  return req.ip;
}
