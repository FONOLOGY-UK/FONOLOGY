import type { Request } from 'express';
import { config } from '../config.js';

/**
 * The IP every rate limiter in this app keys on. Normally just `req.ip` (Express, via `trust proxy`
 * in server.ts, whose hop count is TRUST_PROXY_HOPS).
 *
 * The one exception is traffic that arrives through apps/web's `/api-proxy/*` (used when the web app
 * and API are not same-site, e.g. a cross-site staging deployment). That route adds a hop, so `req.ip`
 * would be the web server, not the visitor. Instead the proxy reads the real client IP off the
 * original request and passes it in a dedicated header, authenticated by a shared secret
 * (INTERNAL_PROXY_SECRET) that only the two services know. This app trusts that header ONLY when the
 * secret matches; every other caller — a browser hitting the API directly included — gets `req.ip`.
 *
 * INTERNAL_PROXY_SECRET unset -> the header is never trusted, full stop.
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
