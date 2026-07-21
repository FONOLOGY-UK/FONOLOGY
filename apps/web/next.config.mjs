import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    // Storefront art is currently inline SVG. When Raja wires real product
    // imagery, add the CDN/host here. Kept empty + unoptimized-safe for now.
    remotePatterns: [],
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
