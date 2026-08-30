import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Product photos are real Supabase Storage uploads (apps/api/src/lib/
 * productImages.ts), served from supabase-js's own `getPublicUrl()`, which
 * always has the shape `${SUPABASE_URL}/storage/v1/object/public/<bucket>/
 * <path>`. Derived from NEXT_PUBLIC_SUPABASE_URL rather than hardcoded so
 * dev and prod point next/image at their own project's Storage host
 * automatically — the same variable already used by the browser Supabase
 * client (lib/supabase-browser.ts). Falls back to an empty pattern list
 * (not a thrown error) when the var is unset, e.g. a fresh mock-mode
 * checkout with no Supabase project configured yet — see the images block
 * below for what that means for the two <Image> call sites.
 */
function supabaseStorageRemotePattern() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return [];
  const { protocol, hostname } = new URL(supabaseUrl);
  return [
    {
      protocol: protocol.replace(':', ''),
      hostname,
      pathname: '/storage/v1/object/public/**',
    },
  ];
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
  eslint: {
    // Lint is run as its own CI/turbo task; don't fail production builds on it.
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    // Product photos (product-card.tsx, product-detail.tsx) — real Supabase
    // Storage uploads as of the real product-image upload feature. See
    // supabaseStorageRemotePattern() above for how the host is derived.
    remotePatterns: supabaseStorageRemotePattern(),
  },
  experimental: {
    // Keep bundle lean; opt into optimized package imports for our icon lib.
    optimizePackageImports: ['lucide-react'],
    // Only applies to the webpack path (`pnpm dev:webpack` and `next build`).
    // Trades a little build speed for a much smaller peak heap — this repo is
    // developed on an 8GB Windows machine where webpack's cache serialisation
    // was hitting ERR_MEMORY_ALLOCATION_FAILED. See NOTES.md → Gotchas.
    webpackMemoryOptimizations: true,
  },
};

export default nextConfig;
