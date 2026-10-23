import { ProductRecordSchema } from "@/lib/schema/product";
import { VariantRecordSchema } from "@/lib/schema/variant";
import { CatalogItemSchema, IdentifierSchema, ITEM_FIELDS } from "./validation";
import { issue } from "./issues";
import type { IssueCode, IssuePath, PinterestBatchResult, PinterestIssue, PinterestOfferResult } from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function amount(minor: number, currency: string): string {
  const value = BigInt(minor);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")} ${currency}`;
}

export function mapOffer(input: unknown): PinterestOfferResult {
  if (!record(input)) return { status: "invalid", issues: [issue("invalid_input", "input")] };
  for (const field of ["product", "variant"] as const) {
    const value = input[field];
    if (record(value) && (value.status === "draft" || value.status === "archived")) {
      return { status: "skipped", reason: `${field}_${value.status}` };
    }
  }
  const parsedProduct = ProductRecordSchema.safeParse(input.product);
  const parsedVariant = VariantRecordSchema.safeParse(input.variant);
  const errors: PinterestIssue[] = [];
  if (!parsedProduct.success) errors.push(issue("invalid_product", "product"));
  if (!parsedVariant.success) errors.push(issue("invalid_variant", "variant"));
  if (!parsedProduct.success || !parsedVariant.success) return { status: "invalid", issues: errors };
  const product = parsedProduct.data;
  const variant = parsedVariant.data;
  if (product.status !== "active") return { status: "skipped", reason: `product_${product.status}` };
  if (variant.status !== "active") return { status: "skipped", reason: `variant_${variant.status}` };
  if (variant.productId !== product.id) errors.push(issue("product_variant_mismatch", "variant.productId"));
  if (variant.currency !== "EUR" && variant.currency !== "TRY") errors.push(issue("unsupported_currency", "price"));
  if (variant.availability === "backorder") errors.push(issue("unsupported_availability", "availability"));
  if (variant.availability === "in_stock" && variant.inventoryQuantity === 0) errors.push(issue("inventory_conflict", "variant.inventoryQuantity"));
  if (errors.length) return { status: "invalid", issues: errors };

  const variantDetails = [variant.color, variant.size]
    .filter((value): value is string => value !== undefined)
    .map((value) => value.normalize("NFC").trim());
  const title = product.title.normalize("NFC").trim()
    + (variantDetails.length ? ` — ${variantDetails.join(" / ")}` : "");
  const primary = variant.imageUrl ?? product.images[0];
  const additional = [...new Set(product.images)].filter((image) => image !== primary);
  const ageGroup = product.ageGroup === "child" ? "kids" : product.ageGroup;
  const attributes = {
    ...(product.brand !== undefined && { brand: product.brand }),
    ...(variant.gtin !== undefined && { GTIN: variant.gtin }),
    ...(variant.mpn !== undefined && { mpn: variant.mpn }),
    ...(variant.color !== undefined && { color: variant.color }),
    ...(variant.size !== undefined && { size: variant.size }),
    ...(product.material !== undefined && { material: product.material }),
    ...(product.pattern !== undefined && { pattern: product.pattern }),
    ...(product.gender !== undefined && { gender: product.gender }),
    ...(ageGroup !== undefined && { age_group: ageGroup }),
  };
  const parsed = CatalogItemSchema.safeParse({
    id: variant.sku, item_group_id: product.id, title, description: product.description,
    link: input.link, image_link: primary,
    ...(additional.length > 0 && { additional_image_link: additional }),
    price: amount(variant.compareAtPriceAmount ?? variant.priceAmount, variant.currency),
    ...(variant.compareAtPriceAmount !== undefined && { sale_price: amount(variant.priceAmount, variant.currency) }),
    availability: { in_stock: "in stock", out_of_stock: "out of stock", preorder: "preorder", backorder: "unsupported" }[variant.availability],
    condition: product.condition, product_type: product.productType, ...attributes,
  });
  if (!parsed.success) {
    const paths = new Set<IssuePath>();
    for (const problem of parsed.error.issues) {
      const field = problem.path[0];
      paths.add(ITEM_FIELDS.includes(field as typeof ITEM_FIELDS[number]) ? field as IssuePath : "item");
    }
    return { status: "invalid", issues: [...paths].map((path) => issue("invalid_field", path)) };
  }
  return { status: "mapped", item: parsed.data, warnings: [issue("external_checks_required", "item", "warning")] };
}

export function mapOffers(inputs: unknown): PinterestBatchResult {
  if (!Array.isArray(inputs) || inputs.length > 1000) {
    return { mapped: [], skipped: [], invalid: [{ index: -1, issues: [issue("batch_limit", "batch")] }] };
  }
  const results = inputs.map(mapOffer);
  const conflicts = new Map<number, PinterestIssue[]>();
  function flag(indices: number[], code: IssueCode, path: IssuePath) {
    for (const index of indices) conflicts.set(index, [...(conflicts.get(index) ?? []), issue(code, path)]);
  }
  const ids = new Map<string, number[]>();
  const gtins = new Map<string, number[]>();
  const combinations = new Map<string, number[]>();
  const families = new Map<string, { indices: number[]; currencies: Set<string> }>();
  function add(group: Map<string, number[]>, key: string, index: number) {
    group.set(key, [...(group.get(key) ?? []), index]);
  }
  inputs.forEach((input, index) => {
    if (results[index]?.status === "skipped" || !record(input) || !record(input.product) || !record(input.variant)) return;
    const product = input.product; const variant = input.variant;
    if (IdentifierSchema.safeParse(variant.sku).success) add(ids, variant.sku as string, index);
    if (typeof variant.gtin === "string" && variant.gtin.length > 0) add(gtins, variant.gtin, index);
    if (!IdentifierSchema.safeParse(product.id).success) return;
    const parent = product.id as string;
    if (typeof variant.currency === "string") {
      const family = families.get(parent) ?? { indices: [], currencies: new Set<string>() };
      family.indices.push(index); family.currencies.add(variant.currency); families.set(parent, family);
    }
    const color = typeof variant.color === "string" ? variant.color.normalize("NFC").trim().toLowerCase() : null;
    const size = typeof variant.size === "string" ? variant.size.normalize("NFC").trim().toLowerCase() : null;
    if (color !== null || size !== null) add(combinations, JSON.stringify([parent, color, size]), index);
  });
  for (const indices of ids.values()) if (indices.length > 1) flag(indices, "duplicate_id", "id");
  for (const indices of gtins.values()) if (indices.length > 1) flag(indices, "duplicate_gtin", "GTIN");
  for (const indices of combinations.values()) if (indices.length > 1) flag(indices, "duplicate_variant", "size");
  for (const family of families.values()) if (family.currencies.size > 1) flag(family.indices, "mixed_currency", "item_group_id");
  const mapped: PinterestBatchResult["mapped"][number][] = [];
  const skipped: PinterestBatchResult["skipped"][number][] = [];
  const invalid: PinterestBatchResult["invalid"][number][] = [];
  results.forEach((result, index) => {
    const problems = conflicts.get(index) ?? [];
    if (result.status === "skipped") skipped.push({ index, reason: result.reason });
    else if (result.status === "invalid") invalid.push({ index, issues: [...result.issues, ...problems] });
    else if (problems.length) invalid.push({ index, issues: problems });
    else mapped.push(result);
  });
  mapped.sort((a, b) => a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0);
  return { mapped, skipped, invalid };
}
