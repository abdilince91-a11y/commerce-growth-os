import { ProductRecordSchema } from "./product";
import { VariantRecordSchema } from "./variant";

// The persistence boundary: the single place where database `null` becomes
// `undefined`.
//
// Prisma returns `null` for nullable columns, but the canonical schemas
// deliberately do not accept `null` (they use "absent" for unknown). Rather
// than weaken those schemas, rows are normalized here first, then validated.
// Adapters read canonical data through these functions.
//
// Only top-level nulls are converted. Nested values (such as the JSON
// `attributes` object) are validated as they are, so a null inside them is
// still rejected.

export function nullsToUndefined<T extends Record<string, unknown>>(
  row: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value === null ? undefined : value;
  }
  return out;
}

// Legacy Product commerce columns (sku, gtin, mpn, priceAmount, priceCurrency,
// availability, category) and other unknown keys are dropped by the schema.
export function parseProductRow(row: Record<string, unknown>) {
  return ProductRecordSchema.safeParse(nullsToUndefined(row));
}

export function parseVariantRow(row: Record<string, unknown>) {
  return VariantRecordSchema.safeParse(nullsToUndefined(row));
}
