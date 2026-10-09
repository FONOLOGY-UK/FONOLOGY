import { z } from 'zod';
import { idSchema } from './common';
import { moneySchema } from './pricing';

/**
 * Product variations (0107 — the rebuild of the old variants, client spec "Product Variation
 * Feature — Complete Rebuild", 8 Oct 2026).
 *
 * A variation product's parent is a placeholder: never sold, no stock of its own. Every sellable
 * unit is one variation — one combination of the product's option values (Colour × Compatibility
 * …), with its own stock, selling price and cost, and optional details of its own (title,
 * description, badge, compatibility, supplier, pictures) that otherwise follow the parent.
 *
 * Mirrors apps/api lib/variations.ts. The customer-facing shape is in product.ts.
 */

/** A colour option shows swatches — decided by its name, as JeezMart does ("Colour", "Color"). */
export function isColourOption(name: string): boolean {
  return /\b(colou?rs?|col)\b/i.test(name);
}

/* ---- Admin ------------------------------------------------------------------------------------ */

export const variationTypeSchema = z.object({
  id: idSchema,
  name: z.string(),
  isColour: z.boolean(),
  values: z.array(z.object({ id: idSchema, value: z.string(), swatchHex: z.string().nullable() })),
});
export type VariationType = z.infer<typeof variationTypeSchema>;

export const productVariantSchema = z.object({
  id: idSchema,
  productId: idSchema,
  options: z.record(z.string()),
  /** "iPhone 13 Pro – Black", in the admin's option order. */
  label: z.string(),
  price: moneySchema,
  costPrice: moneySchema,
  stockQty: z.number().int().min(0),
  barcode: z.string().nullable(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  lowStockAlert: z.boolean(),
  lowStockThreshold: z.number().int().min(1),
  /** The optional details: null = following the parent's. */
  name: z.string().nullable(),
  description: z.string().nullable(),
  tag: z.string().nullable(),
  compatibility: z.string().nullable(),
  supplier: z.string().nullable(),
  /** Its own pictures; empty = the parent's. */
  images: z.array(z.string().url()),
});
export type ProductVariant = z.infer<typeof productVariantSchema>;

export const productVariationsSchema = z.object({
  types: z.array(variationTypeSchema),
  variants: z.array(productVariantSchema),
});
export type ProductVariations = z.infer<typeof productVariationsSchema>;

/** Starting stock and prices for newly generated variations — all three required (spec §5.1). */
export interface VariationStartValues {
  stockQty: number;
  price: number;
  costPrice: number;
}

/** The option structure as the admin wants it saved. No `id` = new; a missing id = deleted. */
export interface VariationStructureInput {
  types: {
    id?: string;
    name: string;
    values: { id?: string; value: string; swatchHex?: string | null }[];
  }[];
  newVariations?: VariationStartValues;
  assignExisting?: Record<string, string>;
  newDefaultOptions?: Record<string, string>;
}

export const variationPreviewSchema = z.object({
  preview: z.object({
    create: z.number().int(),
    remove: z.number().int(),
    total: z.number().int(),
    needsAssignment: z.array(z.string()),
    needsStartValues: z.boolean(),
    needsNewDefault: z.boolean(),
    defaultCandidates: z.array(z.record(z.string())),
    parentStockCleared: z.number().int(),
  }),
});
export type VariationPreview = z.infer<typeof variationPreviewSchema>['preview'];

/** One edit, applied to one variation or many. Only the keys present change. */
export interface VariationEdit {
  price?: number;
  costPrice?: number;
  stockQty?: number;
  isActive?: boolean;
  lowStockAlert?: boolean;
  lowStockThreshold?: number;
  /** null = back to the parent's. */
  name?: string | null;
  description?: string | null;
  tag?: string | null;
  compatibility?: string | null;
  supplier?: string | null;
  images?: { mode: 'add' | 'replace' | 'inherit'; urls: string[] };
  /** Single-variation edits only — every variation needs its own. */
  barcode?: string | null;
}

/** Most variations one product may have (the API refuses more). */
export const MAX_VARIATIONS = 100;

/** "Black – iPhone 13": a variation's choices in the product's option order. */
export function variationLabel(options: Record<string, string>, types: { name: string }[]): string {
  const ordered = types.map((t) => options[t.name]).filter((v): v is string => Boolean(v));
  return ordered.length > 0 ? ordered.join(' – ') : Object.values(options).join(' – ');
}
