import type { IssueCode, IssuePath, PinterestIssue } from "./types";

const MESSAGES: Record<IssueCode, string> = {
  invalid_input: "Offer must be a product, variant and landing URL object.",
  invalid_product: "Canonical product record is invalid.",
  invalid_variant: "Canonical variant record is invalid.",
  product_variant_mismatch: "Variant does not belong to the supplied product.",
  invalid_field: "Field does not meet the Pinterest feed format or local safety rules.",
  unsupported_currency: "This preview supports EUR and TRY only.",
  unsupported_availability: "Availability has no supported Pinterest feed value.",
  inventory_conflict: "Known zero inventory conflicts with in-stock availability.",
  duplicate_id: "Every offer sharing this item ID is rejected.",
  duplicate_gtin: "Every offer sharing this GTIN is rejected.",
  mixed_currency: "All offers in a product family must use one currency.",
  duplicate_variant: "A product family contains a repeated color and size combination.",
  empty_catalog: "A catalog preview must contain at least one mapped active offer.",
  batch_limit: "A preview accepts an array of at most 1000 offers.",
  output_limit: "Encoded CSV exceeds the local 16 MiB preview limit.",
  external_checks_required: "Verify landing-page agreement, image dimensions and access, media disclosures and merchant eligibility before publishing.",
};
export function issue(code: IssueCode, path: IssuePath, severity: "error" | "warning" = "error"): PinterestIssue {
  return { code, path, severity, message: MESSAGES[code] };
}
