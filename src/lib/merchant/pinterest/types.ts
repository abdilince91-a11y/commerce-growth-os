import type { z } from "zod";
import type { ProductRecord } from "@/lib/schema/product";
import type { VariantRecord } from "@/lib/schema/variant";
import type { CatalogItemSchema } from "./validation";

export type PinterestCatalogItem = z.infer<typeof CatalogItemSchema>;
export interface PinterestOfferInput {
  readonly product: ProductRecord;
  readonly variant: VariantRecord;
  readonly link: string;
}
export type IssueCode =
  | "invalid_input" | "invalid_product" | "invalid_variant" | "product_variant_mismatch"
  | "invalid_field" | "unsupported_currency" | "unsupported_availability" | "inventory_conflict"
  | "duplicate_id" | "duplicate_gtin" | "mixed_currency" | "duplicate_variant"
  | "empty_catalog" | "batch_limit" | "output_limit" | "external_checks_required";
export type IssuePath = keyof PinterestCatalogItem | "input" | "product" | "variant" | "variant.productId" | "variant.inventoryQuantity" | "item" | "batch";
export interface PinterestIssue {
  readonly code: IssueCode;
  readonly path: IssuePath;
  readonly severity: "error" | "warning";
  readonly message: string;
}
export interface PinterestMappedOffer {
  readonly status: "mapped";
  readonly item: PinterestCatalogItem;
  readonly warnings: readonly PinterestIssue[];
}
export type SkipReason = "product_draft" | "product_archived" | "variant_draft" | "variant_archived";
export type PinterestOfferResult = PinterestMappedOffer
  | { readonly status: "skipped"; readonly reason: SkipReason }
  | { readonly status: "invalid"; readonly issues: readonly PinterestIssue[] };
export interface PinterestBatchResult {
  readonly mapped: readonly PinterestMappedOffer[];
  readonly skipped: readonly { readonly index: number; readonly reason: SkipReason }[];
  readonly invalid: readonly { readonly index: number; readonly issues: readonly PinterestIssue[] }[];
}
export type PinterestCatalogPreview =
  | ({ readonly status: "ready"; readonly csv: string } & PinterestBatchResult)
  | ({ readonly status: "invalid" } & PinterestBatchResult);
