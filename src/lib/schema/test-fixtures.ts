import type { ZodError } from "zod";

// Shared builders for the canonical schema tests. Not a test file itself.
// GTINs below are real, checksum-valid examples (GS1 check digit verified).

export const GTIN_8 = "96385074";
export const GTIN_12 = "012345678905";
export const GTIN_13 = "0012345678905";
export const GTIN_14 = "10012345678902";

export function product(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    handle: "linen-shirt",
    title: "Linen Shirt",
    description: "A relaxed linen shirt.",
    productType: "shirts",
    images: ["https://example.com/images/linen-shirt.jpg"],
    sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function variant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sku: "LS-BLU-M",
    gtin: GTIN_13,
    priceAmount: 4990,
    currency: "EUR",
    availability: "in_stock",
    color: "Blue",
    size: "M",
    sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function issuePaths(error: ZodError): string[] {
  return error.issues.map((issue) => issue.path.join("."));
}

export function issueMessages(error: ZodError): string[] {
  return error.issues.map((issue) => issue.message);
}
