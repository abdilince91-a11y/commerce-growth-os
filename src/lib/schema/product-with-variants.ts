import { z } from "zod";
import { ProductInputSchema } from "./product";
import { VariantInputSchema } from "./variant";

// A Product together with its Variants, with the rules that only make sense
// across the whole family. See docs/decisions/0003-canonical-product-variant.md.
//
// All violations are collected and reported together; nothing stops at the
// first problem. (Cross-variant rules can only run once every field parsed to
// its expected type, since they read the parsed values.)

// Comparison key only: the stored value is never rewritten. Case, surrounding
// whitespace, and Unicode composition do not make two variants distinct.
function comparable(value: string | undefined): string | null {
  return value === undefined ? null : value.normalize("NFC").trim().toLowerCase();
}

export const ProductWithVariantsInputSchema = z
  .object({
    product: ProductInputSchema,
    variants: z.array(VariantInputSchema),
  })
  .superRefine(({ product, variants }, ctx) => {
    // An active Product must be sellable. Migration-era drafts may have none.
    if (product.status === "active" && variants.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants"],
        message: "An active product must have at least one variant",
      });
    }

    const seenSku = new Map<string, number>();
    const seenGtin = new Map<string, number>();
    const seenAttributes = new Map<string, number>();
    const referenceCurrency = variants[0]?.currency;

    variants.forEach((variant, index) => {
      const skuFirst = seenSku.get(variant.sku);
      if (skuFirst === undefined) {
        seenSku.set(variant.sku, index);
      } else {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants", index, "sku"],
          message: `Duplicate sku (also used by variant ${skuFirst})`,
        });
      }

      if (variant.gtin !== undefined) {
        const gtinFirst = seenGtin.get(variant.gtin);
        if (gtinFirst === undefined) {
          seenGtin.set(variant.gtin, index);
        } else {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["variants", index, "gtin"],
            message: `Duplicate gtin (also used by variant ${gtinFirst})`,
          });
        }
      }

      // Duplicate color/size combinations are rejected here rather than by a
      // database unique constraint, because NULLs are distinct in a unique
      // index. A variant with neither color nor size is "unspecified" (common
      // during migration) and is exempt.
      const color = comparable(variant.color);
      const size = comparable(variant.size);
      if (color !== null || size !== null) {
        const key = JSON.stringify([color, size]);
        const attributesFirst = seenAttributes.get(key);
        if (attributesFirst === undefined) {
          seenAttributes.set(key, index);
        } else {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["variants", index, "size"],
            message: `Duplicate color/size combination (also used by variant ${attributesFirst})`,
          });
        }
      }

      // v0.1: one currency per product.
      if (referenceCurrency !== undefined && variant.currency !== referenceCurrency) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants", index, "currency"],
          message: `All variants of a product must use the same currency (expected ${referenceCurrency})`,
        });
      }
    });
  });

// The name used in the decision record's prose; same schema.
export const ProductWithVariantsSchema = ProductWithVariantsInputSchema;

export type ProductWithVariantsInput = z.infer<typeof ProductWithVariantsInputSchema>;
