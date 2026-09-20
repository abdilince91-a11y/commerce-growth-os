import { z } from "zod";
import {
  AvailabilitySchema,
  CurrencyCodeSchema,
  DateInputSchema,
  HttpUrlSchema,
  IdSchema,
  LifecycleStatusSchema,
  NonBlankStringSchema,
} from "./common";
import { GtinSchema } from "./gtin";

// Canonical Variant: the purchasable unit (one SKU) of a Product. See
// docs/decisions/0003-canonical-product-variant.md.
//
// These schemas do not accept `null`; database nulls become `undefined` at the
// persistence boundary (./persistence-boundary.ts).

// Prisma Int is a 32-bit INTEGER: the largest storable price or quantity.
export const MAX_INT32 = 2_147_483_647;

// Merchant offerId derives from the SKU, so it must be safe inside the
// contentLanguage~feedLabel~offerId identifier.
export const SkuSchema = z
  .string()
  .refine((value) => {
    const length = Array.from(value).length;
    return length >= 1 && length <= 50;
  }, { message: "sku must be 1-50 characters" })
  .refine((value) => !/[~/%\s\p{Cc}]/u.test(value), {
    message: "sku must not contain ~, /, %, whitespace, or control characters",
  });

// Integer minor units (e.g. cents). Positive and within the 32-bit range.
export const PriceAmountSchema = z.number().int().positive().max(MAX_INT32);

export const VariantShape = z.object({
  sku: SkuSchema,
  // Validated exactly as supplied and never rewritten (see ./gtin.ts).
  gtin: GtinSchema.optional(),
  mpn: NonBlankStringSchema.pipe(z.string().max(255)).optional(),
  priceAmount: PriceAmountSchema,
  // The regular/original price. Valid only when strictly greater than priceAmount.
  compareAtPriceAmount: PriceAmountSchema.optional(),
  currency: CurrencyCodeSchema,
  // undefined = unknown; 0 = known zero. There is deliberately no default.
  inventoryQuantity: z.number().int().nonnegative().max(MAX_INT32).optional(),
  availability: AvailabilitySchema,
  // Nullable in the canonical model. Whether it is required for a preorder or
  // backorder is a channel rule (Google Merchant requires it), enforced by
  // that channel's adapter, not here.
  availabilityDate: DateInputSchema.optional(),
  color: NonBlankStringSchema.pipe(z.string().max(100)).optional(),
  size: NonBlankStringSchema.pipe(z.string().max(100)).optional(),
  imageUrl: HttpUrlSchema.optional(),
  status: LifecycleStatusSchema.default("draft"),
  sourceUpdatedAt: DateInputSchema,
});

interface VariantRuleFields {
  gtin?: string | undefined;
  mpn?: string | undefined;
  priceAmount: number;
  compareAtPriceAmount?: number | undefined;
}

function applyVariantRules(value: VariantRuleFields, ctx: z.RefinementCtx): void {
  if (value.gtin === undefined && value.mpn === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["gtin"],
      message: "At least one of gtin or mpn is required",
    });
  }
  if (
    value.compareAtPriceAmount !== undefined &&
    value.compareAtPriceAmount <= value.priceAmount
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["compareAtPriceAmount"],
      message: "compareAtPriceAmount must be greater than priceAmount",
    });
  }
}

export const VariantInputSchema = VariantShape.superRefine(applyVariantRules);

// A Variant as read back from storage: the same fields plus its ids.
export const VariantRecordSchema = VariantShape.extend({
  id: IdSchema,
  productId: IdSchema,
}).superRefine(applyVariantRules);

export type VariantInput = z.infer<typeof VariantInputSchema>;
export type VariantRecord = z.infer<typeof VariantRecordSchema>;
