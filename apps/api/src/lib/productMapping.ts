/**
 * Fields the frontend's `Product` schema requires that have no column in
 * `public.products` — because they were never real structural data, only
 * mock/prototype presentation scaffolding:
 *
 *   - `art`/`tile` — the mock's inline-SVG fallback glyph + tile background,
 *     rendered by product-card.tsx / product-detail.tsx whenever `images` is
 *     empty. `art` already has a precedented, deterministic category->art
 *     mapping in apps/web's own mock.adapter.ts (`CATEGORY_ART`, used when an
 *     admin creates a product) — mirrored here exactly so a product created
 *     for real gets the same glyph a mock-created one would have. `tile`
 *     has no such rule; the same admin-creation path always uses 'bone', so
 *     that's the default here too.
 *   - `tag`, `compatibility` — merchandising copy (badges, device
 *     compatibility) with nowhere to be entered or stored yet. Returned as
 *     `null` — an honest "not set", not fabricated, and both are already
 *     null-safe on the frontend (`product.tag ? ... : null`).
 *   - `highlights`, `specs` — PDP bullet copy / spec table. Returned as `[]`
 *     — the frontend maps over both with no fallback needed for an empty
 *     array.
 *
 * None of this needed a schema migration: every one of these is either
 * derivable from a real column (art, from category) or a safe, honest empty
 * default (everything else). See the B2 report for the full reasoning.
 */

const CATEGORY_ART: Record<string, string> = {
  cases: 'case',
  power: 'charger',
  audio: 'buds',
  protection: 'glass',
  mounts: 'mount',
  vape: 'stand',
  plates: 'tools',
};

export function artForCategory(category: string): string {
  return CATEGORY_ART[category] ?? 'case';
}

export const DEFAULT_TILE = 'bone';
