import { describe, expect, it } from "vitest";
import { GTIN_13, GTIN_8, issuePaths, variant } from "./test-fixtures";
import { VariantInputSchema, VariantRecordSchema } from "./variant";

describe("VariantInputSchema", () => {
  it("accepts a valid variant and defaults status to draft", () => {
    const result = VariantInputSchema.parse(variant());
    expect(result.status).toBe("draft");
    expect(result.sku).toBe("LS-BLU-M");
    expect(result.gtin).toBe(GTIN_13);
  });

  describe("identifiers", () => {
    it("requires at least one of gtin or mpn", () => {
      const result = VariantInputSchema.safeParse(variant({ gtin: undefined }));
      expect(result.success).toBe(false);
      if (!result.success) expect(issuePaths(result.error)).toContain("gtin");
    });

    it("accepts an mpn alone or a gtin alone", () => {
      expect(VariantInputSchema.safeParse(variant({ gtin: undefined, mpn: "MPN-1" })).success).toBe(true);
      expect(VariantInputSchema.safeParse(variant({ gtin: GTIN_8 })).success).toBe(true);
    });

    it("rejects an invalid gtin and returns a valid one exactly as supplied", () => {
      expect(VariantInputSchema.safeParse(variant({ gtin: "0012345678906" })).success).toBe(false);
      expect(VariantInputSchema.parse(variant({ gtin: GTIN_13 })).gtin).toBe(GTIN_13);
    });

    it.each(["LS-BLU-M", "A", "a".repeat(50), "🧵".repeat(50)])("accepts sku %j", (sku) => {
      expect(VariantInputSchema.safeParse(variant({ sku })).success).toBe(true);
    });

    it.each([
      ["empty", ""],
      ["51 characters", "a".repeat(51)],
      ["51 emoji (counted by code point)", "🧵".repeat(51)],
      ["tilde", "A~B"],
      ["slash", "A/B"],
      ["percent", "A%B"],
      ["space", "A B"],
      ["tab", "A\tB"],
      ["newline", "A\nB"],
      ["no-break space", "A B"],
      ["control character", "A\u0007B"],
    ])("rejects sku with %s", (_name, sku) => {
      expect(VariantInputSchema.safeParse(variant({ sku })).success).toBe(false);
    });
  });

  describe("prices (integer minor units)", () => {
    it("accepts positive integers up to the 32-bit maximum", () => {
      expect(VariantInputSchema.safeParse(variant({ priceAmount: 1 })).success).toBe(true);
      expect(VariantInputSchema.safeParse(variant({ priceAmount: 2147483647 })).success).toBe(true);
    });

    it.each([
      ["zero", 0],
      ["negative", -1],
      ["fractional", 12.5],
      ["above 32-bit", 2147483648],
      ["unsafe integer", 2 ** 53],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["numeric string", "1999"],
      ["null", null],
    ])("rejects a priceAmount that is %s", (_name, priceAmount) => {
      expect(VariantInputSchema.safeParse(variant({ priceAmount })).success).toBe(false);
    });
  });

  describe("compareAtPriceAmount (regular price, valid only when greater)", () => {
    it("accepts a value strictly greater than priceAmount", () => {
      expect(
        VariantInputSchema.safeParse(variant({ priceAmount: 4990, compareAtPriceAmount: 5990 })).success,
      ).toBe(true);
    });

    it("rejects equal, lower, and non-positive values", () => {
      for (const compareAtPriceAmount of [4990, 4989, 0, -5]) {
        const result = VariantInputSchema.safeParse(variant({ priceAmount: 4990, compareAtPriceAmount }));
        expect(result.success).toBe(false);
      }
    });

    it("reports the comparison error on compareAtPriceAmount", () => {
      const result = VariantInputSchema.safeParse(variant({ priceAmount: 4990, compareAtPriceAmount: 4990 }));
      expect(result.success).toBe(false);
      if (!result.success) expect(issuePaths(result.error)).toContain("compareAtPriceAmount");
    });

    it("is optional", () => {
      expect(VariantInputSchema.parse(variant()).compareAtPriceAmount).toBeUndefined();
    });
  });

  describe("currency", () => {
    it("accepts any uppercase three-letter code (the canonical model is not limited to a channel's set)", () => {
      for (const currency of ["EUR", "TRY", "USD", "JPY"]) {
        expect(VariantInputSchema.safeParse(variant({ currency })).success).toBe(true);
      }
    });

    it("rejects malformed codes", () => {
      for (const currency of ["eur", "EU", "EURO", "E1R", "", "EUR "]) {
        expect(VariantInputSchema.safeParse(variant({ currency })).success).toBe(false);
      }
    });
  });

  describe("inventoryQuantity (undefined = unknown, 0 = known zero)", () => {
    it("treats an omitted quantity as unknown, not zero", () => {
      const result = VariantInputSchema.parse(variant());
      expect(result.inventoryQuantity).toBeUndefined();
      expect("inventoryQuantity" in result).toBe(false);
    });

    it("keeps a known zero as 0", () => {
      expect(VariantInputSchema.parse(variant({ inventoryQuantity: 0 })).inventoryQuantity).toBe(0);
    });

    it("accepts positive integers", () => {
      expect(VariantInputSchema.parse(variant({ inventoryQuantity: 12 })).inventoryQuantity).toBe(12);
    });

    it.each([
      ["negative", -1],
      ["fractional", 1.5],
      ["null (normalize it at the persistence boundary)", null],
      ["numeric string", "3"],
    ])("rejects a quantity that is %s", (_name, inventoryQuantity) => {
      expect(VariantInputSchema.safeParse(variant({ inventoryQuantity })).success).toBe(false);
    });
  });

  describe("availability and availabilityDate", () => {
    it("accepts every lowercase availability and rejects uppercase spellings", () => {
      for (const availability of ["in_stock", "out_of_stock", "preorder", "backorder"]) {
        expect(VariantInputSchema.safeParse(variant({ availability })).success).toBe(true);
      }
      expect(VariantInputSchema.safeParse(variant({ availability: "IN_STOCK" })).success).toBe(false);
    });

    it("does not require availabilityDate for preorder or backorder (that is a channel rule)", () => {
      for (const availability of ["preorder", "backorder"]) {
        expect(VariantInputSchema.safeParse(variant({ availability })).success).toBe(true);
      }
    });

    it("parses a provided availabilityDate and rejects null instead of using the epoch", () => {
      const parsed = VariantInputSchema.parse(
        variant({ availability: "preorder", availabilityDate: "2026-11-01T00:00:00.000Z" }),
      );
      expect(parsed.availabilityDate?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
      expect(VariantInputSchema.safeParse(variant({ availabilityDate: null })).success).toBe(false);
    });
  });

  describe("other fields", () => {
    it("accepts optional color, size, and an http(s) variant image", () => {
      const result = VariantInputSchema.parse(
        variant({ color: "Blue", size: "M", imageUrl: "https://example.com/blue-m.jpg" }),
      );
      expect(result.imageUrl).toBe("https://example.com/blue-m.jpg");
    });

    it("bounds color and size to 100 characters and rejects blanks", () => {
      expect(VariantInputSchema.safeParse(variant({ color: "x".repeat(101) })).success).toBe(false);
      expect(VariantInputSchema.safeParse(variant({ size: "   " })).success).toBe(false);
    });

    it("allows only http and https variant image URLs", () => {
      for (const imageUrl of ["javascript:alert(1)", "data:image/png;base64,AAAA", "https://u:p@x.com/a.jpg"]) {
        expect(VariantInputSchema.safeParse(variant({ imageUrl })).success).toBe(false);
      }
    });

    it("accepts only lowercase lifecycle values", () => {
      expect(VariantInputSchema.parse(variant({ status: "active" })).status).toBe("active");
      expect(VariantInputSchema.safeParse(variant({ status: "ACTIVE" })).success).toBe(false);
    });

    it("does not accept null anywhere (database nulls are normalized at the persistence boundary)", () => {
      for (const field of ["gtin", "mpn", "color", "size", "imageUrl", "compareAtPriceAmount"]) {
        expect(VariantInputSchema.safeParse(variant({ [field]: null })).success).toBe(false);
      }
    });
  });

  it("collects every field error rather than stopping at the first", () => {
    const result = VariantInputSchema.safeParse(
      variant({ sku: "bad sku", priceAmount: 0, currency: "eur", availability: "IN_STOCK", gtin: "123" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = issuePaths(result.error);
      for (const expected of ["sku", "priceAmount", "currency", "availability", "gtin"]) {
        expect(paths).toContain(expected);
      }
    }
  });
});

describe("VariantRecordSchema", () => {
  it("adds required id and productId and applies the same rules", () => {
    expect(VariantRecordSchema.safeParse(variant()).success).toBe(false);
    const ok = VariantRecordSchema.parse(variant({ id: "ckvariant000000000001", productId: "ckproduct0000000000001" }));
    expect(ok.productId).toBe("ckproduct0000000000001");
    expect(
      VariantRecordSchema.safeParse(
        variant({ id: "v1", productId: "p1", priceAmount: 100, compareAtPriceAmount: 100 }),
      ).success,
    ).toBe(false);
  });
});
