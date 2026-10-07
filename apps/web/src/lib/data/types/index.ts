/**
 * Barrel for every domain type + Zod schema. Import from `@/lib/data/types`.
 * Keeping these framework-free is deliberate: they can move into a shared
 * package later.
 */
export * from './common';
export * from './pricing';
export * from './product';
export * from './repair';
export * from './review';
export * from './order';
export * from './sell';
export * from './tracking';
// ---- admin domain (item 7) ----
export * from './job';
export * from './staff';
export * from './finance';
export * from './inventory';
export * from './promotion';
export * from './label';
export * from './print';
export * from './settings';
export * from './shop';
export * from './shops';
export * from './delivery';
export * from './inventory-logs';
export * from './page';
export * from './analytics';
// ---- employee POS + auth (items 8–9) ----
export * from './pos';
export * from './auth';
