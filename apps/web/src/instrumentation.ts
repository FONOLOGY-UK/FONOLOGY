/**
 * Runs once, when the Next.js server process starts — a boot-time check that has no other natural home.
 *
 * `INTERNAL_PROXY_SECRET` unset is allowed: /api-proxy still forwards requests, just without the
 * client-IP header the API's rate limiter needs. That fails soft rather than taking the storefront
 * down, but it is almost always a misconfiguration, so say so once at boot. Mirrors the equivalent
 * check in apps/api/src/server.ts.
 */
export function register() {
  if (!process.env.INTERNAL_PROXY_SECRET) {
    // eslint-disable-next-line no-console
    console.warn(
      '[web] INTERNAL_PROXY_SECRET is not set — /api-proxy will not forward a real client IP to the ' +
        "API's rate limiter. Set the same value on fonology-web and fonology-api if it should be.",
    );
  }
}
