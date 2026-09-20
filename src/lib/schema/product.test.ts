import { describe, expect, it } from "vitest";
import { ProductInputSchema, ProductRecordSchema } from "./product";
import { issuePaths, product } from "./test-fixtures";

describe("ProductInputSchema", () => {
  it("accepts a minimal valid product and applies the documented defaults", () => {
    const result = ProductInputSchema.parse(product());
    expect(result.condition).toBe("new");
    expect(result.status).toBe("draft");
    expect(result.tags).toEqual([]);
    expect(result.attributes).toEqual({});
    expect(result.sizeTypes).toEqual([]);
    expect(result.sourceUpdatedAt).toBeInstanceOf(Date);
  });

  it("accepts a fully specified apparel product", () => {
    const result = ProductInputSchema.safeParse(
      product({
        brand: "ONOE",
        material: "linen",
        condition: "new",
        tags: ["summer", "linen"],
        attributes: { fit: "relaxed" },
        status: "active",
        gender: "unisex",
        ageGroup: "adult",
        pattern: "solid",
        sizeSystem: "eu",
        sizeTypes: ["regular", "tall"],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("leaves gender and ageGroup optional (nullable during migration)", () => {
    const result = ProductInputSchema.parse(product());
    expect(result.gender).toBeUndefined();
    expect(result.ageGroup).toBeUndefined();
  });

  it("accepts only lowercase enum values", () => {
    for (const bad of [
      { condition: "NEW" },
      { status: "ACTIVE" },
      { gender: "MALE" },
      { ageGroup: "ADULT" },
      { sizeTypes: ["REGULAR"] },
      { condition: "mint" },
    ]) {
      expect(ProductInputSchema.safeParse(product(bad)).success).toBe(false);
    }
  });

  it.each([
    ["uppercase", "Linen-Shirt"],
    ["spaces", "linen shirt"],
    ["underscore", "linen_shirt"],
    ["leading hyphen", "-linen"],
    ["trailing hyphen", "linen-"],
    ["double hyphen", "linen--shirt"],
    ["empty", ""],
  ])("rejects a handle with %s", (_name, handle) => {
    expect(ProductInputSchema.safeParse(product({ handle })).success).toBe(false);
  });

  it("rejects blank title, description, and productType", () => {
    for (const field of ["title", "description", "productType"]) {
      expect(ProductInputSchema.safeParse(product({ [field]: "" })).success).toBe(false);
      expect(ProductInputSchema.safeParse(product({ [field]: "   " })).success).toBe(false);
    }
  });

  it("requires at least one shared image", () => {
    expect(ProductInputSchema.safeParse(product({ images: [] })).success).toBe(false);
  });

  it("allows only http and https image URLs", () => {
    for (const image of ["javascript:alert(1)", "data:image/png;base64,AAAA", "ftp://x.com/a.jpg"]) {
      expect(ProductInputSchema.safeParse(product({ images: [image] })).success).toBe(false);
    }
  });

  it("rejects duplicate tags and duplicate sizeTypes", () => {
    expect(ProductInputSchema.safeParse(product({ tags: ["a", "a"] })).success).toBe(false);
    expect(
      ProductInputSchema.safeParse(product({ sizeTypes: ["regular", "regular"] })).success,
    ).toBe(false);
  });

  it("bounds pattern to 100 characters and sizeSystem to a short lowercase token", () => {
    expect(ProductInputSchema.safeParse(product({ pattern: "x".repeat(101) })).success).toBe(false);
    expect(ProductInputSchema.safeParse(product({ sizeSystem: "EU" })).success).toBe(false);
    expect(ProductInputSchema.safeParse(product({ sizeSystem: "x" })).success).toBe(false);
    expect(ProductInputSchema.safeParse(product({ sizeSystem: "abcdefghi" })).success).toBe(false);
    expect(ProductInputSchema.safeParse(product({ sizeSystem: "uk" })).success).toBe(true);
  });

  it("keeps attributes as a flat string-to-string map", () => {
    expect(ProductInputSchema.safeParse(product({ attributes: { a: { b: "c" } } })).success).toBe(
      false,
    );
    expect(ProductInputSchema.safeParse(product({ attributes: { a: null } })).success).toBe(false);
  });

  it("does not accept null (database nulls are normalized at the persistence boundary)", () => {
    expect(ProductInputSchema.safeParse(product({ brand: null })).success).toBe(false);
    expect(ProductInputSchema.safeParse(product({ gender: null })).success).toBe(false);
    expect(ProductInputSchema.safeParse(product({ sourceUpdatedAt: null })).success).toBe(false);
  });

  it("strips the legacy commerce columns instead of carrying them", () => {
    const result = ProductInputSchema.parse(
      product({
        sku: "LEGACY-1",
        gtin: "0012345678905",
        mpn: "MPN-1",
        priceAmount: 1999,
        priceCurrency: "USD",
        availability: "in_stock",
        category: "widgets",
      }),
    );
    for (const key of ["sku", "gtin", "mpn", "priceAmount", "priceCurrency", "availability", "category"]) {
      expect(key in result).toBe(false);
    }
  });

  it("no longer requires gtin or mpn (that rule moved to Variant)", () => {
    expect(ProductInputSchema.safeParse(product()).success).toBe(true);
  });

  it("collects every field error rather than stopping at the first", () => {
    const result = ProductInputSchema.safeParse(
      product({
        handle: "Bad Handle",
        title: "",
        images: [],
        condition: "NEW",
        gender: "MALE",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = issuePaths(result.error);
      for (const expected of ["handle", "title", "images", "condition", "gender"]) {
        expect(paths).toContain(expected);
      }
    }
  });
});

describe("ProductRecordSchema", () => {
  it("adds a required stable id (used verbatim as the Merchant itemGroupId)", () => {
    expect(ProductRecordSchema.safeParse(product()).success).toBe(false);
    const result = ProductRecordSchema.parse(product({ id: "ckproduct0000000000001" }));
    expect(result.id).toBe("ckproduct0000000000001");
  });
});
