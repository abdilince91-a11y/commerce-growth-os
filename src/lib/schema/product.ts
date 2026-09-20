import { z } from "zod";
import {
  AgeGroupSchema,
  DateInputSchema,
  GenderSchema,
  HttpUrlSchema,
  IdSchema,
  LifecycleStatusSchema,
  NonBlankStringSchema,
  ProductConditionSchema,
  SizeTypeSchema,
} from "./common";

// Canonical Product (the family). Validates untrusted external product data at
// the ingestion boundary. Offer-level data (SKU, GTIN/MPN, price, currency,
// inventory, availability, color, size) lives on Variant — see
// docs/decisions/0003-canonical-product-variant.md.
//
// The legacy Product commerce columns still exist in the database as
// nullable compatibility columns, but they are intentionally not part of this
// schema: zod strips unknown keys, so they never enter canonical data.
//
// These schemas do not accept `null`. Database nulls are converted to
// `undefined` at the persistence boundary (./persistence-boundary.ts).

export { AvailabilitySchema } from "./common";

export const HandleSchema = z
  .string()
  .max(255)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "must be a lowercase slug: letters, digits, and single hyphens",
  });

const TagSchema = z.string().trim().min(1).max(100);

// Bounded, lowercase token such as "eu", "us", or "uk". A bounded string
// rather than an enum, so a new size system needs no migration.
export const SizeSystemSchema = z
  .string()
  .regex(/^[a-z]{2,8}$/, { message: "must be 2-8 lowercase ASCII letters" });

function hasNoDuplicates(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const ProductInputSchema = z.object({
  handle: HandleSchema,
  title: NonBlankStringSchema,
  description: NonBlankStringSchema,
  brand: NonBlankStringSchema.optional(),
  productType: NonBlankStringSchema,
  material: NonBlankStringSchema.optional(),
  condition: ProductConditionSchema.default("new"),
  // Shared images. The first is the primary image unless a variant supplies one.
  images: z.array(HttpUrlSchema).min(1),
  tags: z
    .array(TagSchema)
    .refine(hasNoDuplicates, { message: "tags must be unique" })
    .default([]),
  // Channel-neutral escape hatch for product-level attributes that are not
  // modeled as fields. Not a place for advertising-platform keys.
  attributes: z.record(z.string(), z.string()).default({}),
  status: LifecycleStatusSchema.default("draft"),

  // Apparel metadata. Optional because gender and ageGroup are nullable in the
  // database during migration; tightening them is a later, explicit decision.
  gender: GenderSchema.optional(),
  ageGroup: AgeGroupSchema.optional(),
  pattern: NonBlankStringSchema.pipe(z.string().max(100)).optional(),
  sizeSystem: SizeSystemSchema.optional(),
  sizeTypes: z
    .array(SizeTypeSchema)
    .refine(hasNoDuplicates, { message: "sizeTypes must be unique" })
    .default([]),

  sourceUpdatedAt: DateInputSchema,
});

// A Product as read back from storage: the same fields plus its stable id.
// `id` is the source of the Merchant itemGroupId (used verbatim).
export const ProductRecordSchema = ProductInputSchema.extend({ id: IdSchema });

export type ProductInput = z.infer<typeof ProductInputSchema>;
export type ProductRecord = z.infer<typeof ProductRecordSchema>;
