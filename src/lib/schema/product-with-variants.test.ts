import { describe, expect, it } from "vitest";
import { ProductWithVariantsInputSchema, ProductWithVariantsSchema } from "./product-with-variants";
import { GTIN_12, GTIN_13, GTIN_14, GTIN_8, issueMessages, issuePaths, product, variant } from "./test-fixtures";

function family(overrides: {
  product?: Record<string, unknown>;
  variants?: Record<string, unknown>[];
} = {}) {
  return {
    product: product(overrides.product ?? {}),
    variants: overrides.variants ?? [
      variant({ sku: "LS-BLU-M", gtin: GTIN_13, color: "Blue", size: "M" }),
      variant({ sku: "LS-BLU-L", gtin: GTIN_12, color: "Blue", size: "L" }),
      variant({ sku: "LS-RED-M", gtin: GTIN_14, color: "Red", size: "M" }),
    ],
  };
}

describe("ProductWithVariantsInputSchema", () => {
  it("accepts a product with several distinguishable variants", () => {
    expect(ProductWithVariantsInputSchema.safeParse(family()).success).toBe(true);
  });

  it("is also exported under the name used in the decision record", () => {
    expect(ProductWithVariantsSchema).toBe(ProductWithVariantsInputSchema);
  });

  describe("an active product must be sellable", () => {
    it("rejects an active product with zero variants", () => {
      const result = ProductWithVariantsInputSchema.safeParse(
        family({ product: { status: "active" }, variants: [] }),
      );
      expect(result.success).toBe(false);
      if (!result.success) expect(issuePaths(result.error)).toContain("variants");
    });

    it("allows migration-era draft and archived products with zero variants", () => {
      for (const status of ["draft", "archived"]) {
        expect(
          ProductWithVariantsInputSchema.safeParse(family({ product: { status }, variants: [] })).success,
        ).toBe(true);
      }
    });

    it("accepts an active product with one variant", () => {
      expect(
        ProductWithVariantsInputSchema.safeParse(
          family({ product: { status: "active" }, variants: [variant()] }),
        ).success,
      ).toBe(true);
    });
  });

  describe("duplicates", () => {
    it("rejects a duplicate sku", () => {
      const result = ProductWithVariantsInputSchema.safeParse(
        family({
          variants: [
            variant({ sku: "DUP", gtin: GTIN_13, color: "Blue", size: "M" }),
            variant({ sku: "DUP", gtin: GTIN_12, color: "Red", size: "M" }),
          ],
        }),
      );
      expect(result.success).toBe(false);
      if (!result.success) expect(issuePaths(result.error)).toContain("variants.1.sku");
    });

    it("rejects a duplicate gtin", () => {
      const result = ProductWithVariantsInputSchema.safeParse(
        family({
          variants: [
            variant({ sku: "A", gtin: GTIN_13, color: "Blue", size: "M" }),
            variant({ sku: "B", gtin: GTIN_13, color: "Red", size: "M" }),
          ],
        }),
      );
      expect(result.success).toBe(false);
      if (!result.success) expect(issuePaths(result.error)).toContain("variants.1.gtin");
    });

    it("does not treat a zero-padded GTIN as a duplicate (GTINs are never rewritten)", () => {
      expect(GTIN_12).not.toBe(GTIN_13);
      const result = ProductWithVariantsInputSchema.safeParse(
        family({
          variants: [
            variant({ sku: "A", gtin: GTIN_12, color: "Blue", size: "M" }),
            variant({ sku: "B", gtin: GTIN_13, color: "Red", size: "M" }),
          ],
        }),
      );
      expect(result.success).toBe(true);
    });

    it("rejects a duplicate non-null color/size combination", () => {
      const result = ProductWithVariantsInputSchema.safeParse(
        family({
          variants: [
            variant({ sku: "A", gtin: GTIN_13, color: "Blue", size: "M" }),
            variant({ sku: "B", gtin: GTIN_12, color: "Blue", size: "M" }),
          ],
        }),
      );
      expect(result.success).toBe(false);
      if (!result.success) expect(issueMessages(result.error).join(" ")).toMatch(/color\/size/);
    });

    it("compares color and size ignoring case, surrounding spaces, and Unicode composition", () => {
      const composed = "Café";
      const decomposed = "Café";
      const result = ProductWithVariantsInputSchema.safeParse(
        family({
          variants: [
            variant({ sku: "A", gtin: GTIN_13, color: composed, size: "M" }),
            variant({ sku: "B", gtin: GTIN_12, color: `  ${decomposed.toUpperCase()} `, size: "m" }),
          ],
        }),
      );
      expect(result.success).toBe(false);
    });

    it("rejects duplicates where only one of color or size is set", () => {
      const result = ProductWithVariantsInputSchema.safeParse(
        family({
          variants: [
            variant({ sku: "A", gtin: GTIN_13, color: "Blue", size: undefined }),
            variant({ sku: "B", gtin: GTIN_12, color: "Blue", size: undefined }),
          ],
        }),
      );
      expect(result.success).toBe(false);
    });

    it("allows the same color in different sizes and the same size in different colors", () => {
      expect(ProductWithVariantsInputSchema.safeParse(family()).success).toBe(true);
    });

    it("keeps a color-only variant distinct from a size-only variant with the same text", () => {
      const result = ProductWithVariantsInputSchema.safeParse(
        family({
          variants: [
            variant({ sku: "A", gtin: GTIN_13, color: "M", size: undefined }),
            variant({ sku: "B", gtin: GTIN_12, color: undefined, size: "M" }),
          ],
        }),
      );
      expect(result.success).toBe(true);
    });

    it("does not treat variants with neither color nor size as duplicates (unspecified, common during migration)", () => {
      const result = ProductWithVariantsInputSchema.safeParse(
        family({
          variants: [
            variant({ sku: "A", gtin: GTIN_13, color: undefined, size: undefined }),
            variant({ sku: "B", gtin: GTIN_12, color: undefined, size: undefined }),
          ],
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe("currency", () => {
    it("rejects variants of one product that use different currencies", () => {
      const result = ProductWithVariantsInputSchema.safeParse(
        family({
          variants: [
            variant({ sku: "A", gtin: GTIN_13, color: "Blue", size: "M", currency: "EUR" }),
            variant({ sku: "B", gtin: GTIN_12, color: "Blue", size: "L", currency: "TRY" }),
          ],
        }),
      );
      expect(result.success).toBe(false);
      if (!result.success) expect(issuePaths(result.error)).toContain("variants.1.currency");
    });

    it("accepts one shared currency, including a non-Merchant one (the canonical model is not channel-limited)", () => {
      expect(
        ProductWithVariantsInputSchema.safeParse(
          family({
            variants: [
              variant({ sku: "A", gtin: GTIN_13, color: "Blue", size: "M", currency: "USD" }),
              variant({ sku: "B", gtin: GTIN_8, color: "Blue", size: "L", currency: "USD" }),
            ],
          }),
        ).success,
      ).toBe(true);
    });
  });

  describe("error collection", () => {
    it("reports several cross-variant problems together", () => {
      const result = ProductWithVariantsInputSchema.safeParse({
        product: product({ status: "active" }),
        variants: [
          variant({ sku: "DUP", gtin: GTIN_13, color: "Blue", size: "M", currency: "EUR" }),
          variant({ sku: "DUP", gtin: GTIN_12, color: "Blue", size: "M", currency: "TRY" }),
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = issuePaths(result.error);
        expect(paths).toContain("variants.1.sku");
        expect(paths).toContain("variants.1.size");
        expect(paths).toContain("variants.1.currency");
      }
    });

    it("reports product and variant field errors together", () => {
      const result = ProductWithVariantsInputSchema.safeParse({
        product: product({ handle: "Bad Handle", title: "" }),
        variants: [variant({ sku: "bad sku", priceAmount: 0 })],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = issuePaths(result.error);
        expect(paths).toContain("product.handle");
        expect(paths).toContain("product.title");
        expect(paths).toContain("variants.0.sku");
        expect(paths).toContain("variants.0.priceAmount");
      }
    });
  });
});
