import { describe, expect, it } from "vitest";
import { ProductInputSchema } from "./product";

const validBase = {
  sku: "SKU-1",
  title: "Test Product",
  description: "A product used in tests.",
  category: "widgets",
  priceAmount: 1999,
  priceCurrency: "USD",
  availability: "in_stock" as const,
  images: ["https://example.com/image.jpg"],
  sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
};

describe("ProductInputSchema", () => {
  it("accepts a valid product with a gtin", () => {
    const result = ProductInputSchema.safeParse({ ...validBase, gtin: "0012345678905" });
    expect(result.success).toBe(true);
  });

  it("accepts a valid product with an mpn", () => {
    const result = ProductInputSchema.safeParse({ ...validBase, mpn: "MPN-123" });
    expect(result.success).toBe(true);
  });

  it("rejects a product with neither gtin nor mpn", () => {
    const result = ProductInputSchema.safeParse(validBase);
    expect(result.success).toBe(false);
  });

  it("rejects a product with no images", () => {
    const result = ProductInputSchema.safeParse({
      ...validBase,
      gtin: "0012345678905",
      images: [],
    });
    expect(result.success).toBe(false);
  });

  it("defaults attributes to an empty object", () => {
    const result = ProductInputSchema.parse({ ...validBase, gtin: "0012345678905" });
    expect(result.attributes).toEqual({});
  });
});
