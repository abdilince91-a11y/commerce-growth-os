import { describe, expect, it } from "vitest";
import { ProductRecordSchema } from "./product";
import { nullsToUndefined, parseProductRow, parseVariantRow } from "./persistence-boundary";
import { GTIN_13 } from "./test-fixtures";
import { VariantRecordSchema } from "./variant";

// Rows shaped like what Prisma returns: nullable columns arrive as null, dates
// as Date objects, and the legacy Product commerce columns are still present.
function productRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ckproduct0000000000001",
    handle: "linen-shirt",
    title: "Linen Shirt",
    description: "A relaxed linen shirt.",
    brand: null,
    productType: "shirts",
    material: null,
    condition: "new",
    images: ["https://example.com/images/linen-shirt.jpg"],
    tags: [],
    attributes: {},
    status: "draft",
    gender: null,
    ageGroup: null,
    pattern: null,
    sizeSystem: null,
    sizeTypes: [],
    sourceUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    canonicalUpdatedAt: new Date("2026-01-02T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    // legacy compatibility columns
    sku: "LEGACY-1",
    gtin: GTIN_13,
    mpn: null,
    priceAmount: 1999,
    priceCurrency: "USD",
    availability: "in_stock",
    category: "widgets",
    ...overrides,
  };
}

function variantRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ckvariant000000000001",
    productId: "ckproduct0000000000001",
    sku: "LS-BLU-M",
    gtin: null,
    mpn: "MPN-1",
    priceAmount: 4990,
    compareAtPriceAmount: null,
    currency: "EUR",
    inventoryQuantity: null,
    availability: "in_stock",
    availabilityDate: null,
    color: null,
    size: null,
    imageUrl: null,
    status: "draft",
    sourceUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    canonicalUpdatedAt: new Date("2026-01-02T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("nullsToUndefined", () => {
  it("turns top-level nulls into undefined and leaves everything else untouched", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const out = nullsToUndefined({ a: null, b: 0, c: "", d: false, e: date, f: [null] });
    expect(out.a).toBeUndefined();
    expect(out.b).toBe(0);
    expect(out.c).toBe("");
    expect(out.d).toBe(false);
    expect(out.e).toBe(date);
    expect(out.f).toEqual([null]);
  });

  it("does not mutate its input", () => {
    const row = { a: null };
    nullsToUndefined(row);
    expect(row.a).toBeNull();
  });
});

describe("canonical schemas are not weakened", () => {
  it("still reject raw database rows that contain nulls", () => {
    expect(ProductRecordSchema.safeParse(productRow()).success).toBe(false);
    expect(VariantRecordSchema.safeParse(variantRow()).success).toBe(false);
  });
});

describe("parseProductRow", () => {
  it("normalizes a Prisma-shaped row and keeps the stable id", () => {
    const result = parseProductRow(productRow());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("ckproduct0000000000001");
      expect(result.data.brand).toBeUndefined();
      expect(result.data.gender).toBeUndefined();
      expect(result.data.sourceUpdatedAt).toBeInstanceOf(Date);
    }
  });

  it("drops the legacy commerce columns and audit timestamps", () => {
    const result = parseProductRow(productRow());
    expect(result.success).toBe(true);
    if (result.success) {
      for (const key of [
        "sku", "gtin", "mpn", "priceAmount", "priceCurrency", "availability", "category",
        "canonicalUpdatedAt", "createdAt",
      ]) {
        expect(key in result.data).toBe(false);
      }
    }
  });

  it("still validates: a null required column is rejected, not defaulted", () => {
    expect(parseProductRow(productRow({ title: null })).success).toBe(false);
    expect(parseProductRow(productRow({ sourceUpdatedAt: null })).success).toBe(false);
  });

  it("does not hide a null nested inside the JSON attributes", () => {
    expect(parseProductRow(productRow({ attributes: { fit: null } })).success).toBe(false);
  });
});

describe("parseVariantRow", () => {
  it("treats null inventory as unknown (undefined), not zero", () => {
    const result = parseVariantRow(variantRow({ inventoryQuantity: null }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.inventoryQuantity).toBeUndefined();
  });

  it("keeps a known zero inventory as 0", () => {
    const result = parseVariantRow(variantRow({ inventoryQuantity: 0 }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.inventoryQuantity).toBe(0);
  });

  it("treats a null availabilityDate as absent, not the Unix epoch", () => {
    const result = parseVariantRow(variantRow({ availability: "preorder", availabilityDate: null }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.availabilityDate).toBeUndefined();
  });

  it("normalizes every nullable variant column", () => {
    const result = parseVariantRow(variantRow());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gtin).toBeUndefined();
      expect(result.data.compareAtPriceAmount).toBeUndefined();
      expect(result.data.color).toBeUndefined();
      expect(result.data.size).toBeUndefined();
      expect(result.data.imageUrl).toBeUndefined();
      expect(result.data.productId).toBe("ckproduct0000000000001");
    }
  });

  it("still applies the variant rules after normalizing", () => {
    expect(parseVariantRow(variantRow({ mpn: null, gtin: null })).success).toBe(false);
    expect(parseVariantRow(variantRow({ priceAmount: 100, compareAtPriceAmount: 100 })).success).toBe(false);
  });
});
