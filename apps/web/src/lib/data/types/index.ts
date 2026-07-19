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
