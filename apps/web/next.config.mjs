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
