/**
 * Barrel for every domain type + Zod schema. Import from `@/lib/data/types`.
 * These are the shapes that will move into `packages/contracts` when Raja
 * adds the API app — keeping them framework-free is deliberate.
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
export * from './settings';
export * from './analytics';
// ---- employee POS + auth (items 8–9) ----
export * from './pos';
export * from './auth';
