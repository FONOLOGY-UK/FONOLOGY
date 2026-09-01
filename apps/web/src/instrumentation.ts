/**
 * Runs once, when the Next.js server process starts — Next's own hook for
 * exactly this: a boot-time check that has no other natural home (there's
 * no shared "app entry point" the way apps/api's server.ts is one).
 *
 * `INTERNAL_PROXY_SECRET` unset is a legitimate, supported state (see
 * app/api-proxy/[...path]/route.ts and app/api-internal/revalidate-product/
 * route.ts) — both routes fail SOFT by design: the proxy still forwards
 * requests, just without the client-IP header the API's rate limiter needs
 * to see the real caller; the revalidation route 401s harmlessly and the
 * PDP just stays static-forever until the next deploy. That's the right
 * runtime behaviour — an internal wiring gap between this project's own two
 * services should never take the storefront down — but "correct and
 * silent" is also exactly how this kind of gap survives for months. One
 * line at boot, once, trades that invisibility for a log line an operator
 * can actually go looking for. Mirrors the equivalent check in
 * apps/api/src/server.ts — keep both in sync if this ever changes.
 */
export function register() {
  if (!process.env.INTERNAL_PROXY_SECRET) {
    // eslint-disable-next-line no-console
    console.warn(
      '[web] INTERNAL_PROXY_SECRET is not set — /api-proxy will not forward a ' +
        "real client IP to the API's rate limiter, and " +
        '/api-internal/revalidate-product will refuse every callback from ' +
        'apps/api after a product edit. Both fail soft rather than break the ' +
        'site, but this is very likely a misconfiguration, not an intentional ' +
        'choice — set the same value on both fonology-web and fonology-api ' +
        '(render.yaml: fonology-shared env var group) if it should be.',
    );
  }
}
