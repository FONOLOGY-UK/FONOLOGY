import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Product photos are uploaded by the API (apps/api/src/lib/productImages.ts)
 * and served from STORAGE_PUBLIC_URL — the product-images bucket's public
 * endpoint: http://localhost:3902 on the local stack. next/image only fetches
 * from hosts listed here, so this is derived from that same variable. Unset
 * means no remote images are allowed, not a crash.
 */
function storageRemotePattern() {
  const storageUrl = process.env.STORAGE_PUBLIC_URL;
  if (!storageUrl) return [];
  const { protocol, hostname, port } = new URL(storageUrl);
  return [{ protocol: protocol.replace(':', ''), hostname, port, pathname: '/**' }];
}

/**
 * Baseline Content-Security-Policy, REPORT-ONLY. Stored product HTML is sanitised by the API now, but a CSP
 * is the second line if anything ever slips through. Report-only means the browser logs violations to the
 * console and blocks nothing, so it cannot break the storefront, Stripe or the till; once the live site has
 * run clean it can be switched to `Content-Security-Policy` (see docs/go-live.md).
 */
function contentSecurityPolicyReportOnly() {
  const api = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
  const storage = process.env.STORAGE_PUBLIC_URL
    ? new URL(process.env.STORAGE_PUBLIC_URL).origin
    : '';
  const list = (...parts) => parts.filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    list("script-src 'self' 'unsafe-inline' https://js.stripe.com"),
    list("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"),
    list("font-src 'self' data: https://fonts.gstatic.com"),
    list("img-src 'self' data: blob: https:", storage),
    list("connect-src 'self' https://api.stripe.com", api),
    'frame-src https://js.stripe.com https://hooks.stripe.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-hosted VPS deployment via Docker/Coolify — NOT Vercel.
  // `standalone` emits a minimal Node server + traced deps into .next/standalone,
  // which the Dockerfile copies into a plain node:alpine container.
  output: 'standalone',
  // Trace workspace deps from the monorepo root so the standalone bundle is
  // complete (pnpm hoists some deps to the root node_modules).
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    // Baseline hardening for every page. A Content-Security-Policy is deliberately not here yet: the
    // storefront loads Stripe and inline animation styles, so it needs its own report-only trial
    // against the live site first (see docs/go-live.md).
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicyReportOnly() },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  eslint: {
    // Lint is run as its own CI/turbo task; don't fail production builds on it.
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    // Product photos (product-card.tsx, product-detail.tsx). See
    // storageRemotePattern() above for how the host is derived.
    remotePatterns: storageRemotePattern(),
  },
  experimental: {
    // Keep bundle lean; opt into optimized package imports for our icon lib.
    optimizePackageImports: ['lucide-react'],
    // Only applies to the webpack path (`pnpm dev:webpack` and `next build`).
    // Trades a little build speed for a much smaller peak heap — this repo is
    // developed on an 8GB Windows machine where webpack's cache serialisation
    // was hitting ERR_MEMORY_ALLOCATION_FAILED.
    webpackMemoryOptimizations: true,
  },
};

export default nextConfig;
