import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * Label designer templates (item 7, Generate Label). These are the free-form
 * shelf/price/info labels — SEPARATE from the printable job/device labels the
 * Jobs module produces. Templates are saveable and print-optimised.
 */

export const labelLineSizeSchema = z.enum(['sm', 'md', 'lg']);
export type LabelLineSize = z.infer<typeof labelLineSizeSchema>;

export const labelLineSchema = z.object({
  text: z.string(),
  size: labelLineSizeSchema,
  bold: z.boolean(),
});
export type LabelLine = z.infer<typeof labelLineSchema>;

export const labelTemplateInputSchema = z.object({
  name: z.string().trim().min(2, 'Name the template'),
  lines: z.array(labelLineSchema).min(1).max(6),
  /** Optional Code 39 barcode value; null = no barcode on the label. */
  barcode: z.string().nullable(),
});
export type LabelTemplateInput = z.infer<typeof labelTemplateInputSchema>;

export const labelTemplateSchema = labelTemplateInputSchema.extend({
  id: idSchema,
  updatedAt: isoDateTimeSchema,
});
export type LabelTemplate = z.infer<typeof labelTemplateSchema>;
