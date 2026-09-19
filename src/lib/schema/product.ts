import { z } from "zod";

// Mirrors prisma/schema.prisma's Product model. Validates untrusted
// external product data at the ingestion boundary — see
// docs/decisions/0001-canonical-product-schema.md.

export const AvailabilitySchema = z.enum([
  "in_stock",
  "out_of_stock",
  "preorder",
  "backorder",
]);

export const ProductInputSchema = z
  .object({
    sku: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    brand: z.string().min(1).optional(),
    gtin: z.string().min(1).optional(),
    mpn: z.string().min(1).optional(),
    category: z.string().min(1),
    priceAmount: z.number().int().nonnegative(),
    priceCurrency: z.string().length(3),
    availability: AvailabilitySchema,
    images: z.array(z.string().url()).min(1),
    attributes: z.record(z.string(), z.string()).default({}),
    sourceUpdatedAt: z.coerce.date(),
  })
  .refine((product) => Boolean(product.gtin) || Boolean(product.mpn), {
    message: "At least one of gtin or mpn is required",
    path: ["gtin"],
  });

export type ProductInput = z.infer<typeof ProductInputSchema>;
