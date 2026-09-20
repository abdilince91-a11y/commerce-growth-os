// Structured issues for the Google Merchant mapper (Slice 2).
//
// Every problem is reported as a MerchantIssue: a stable machine-readable code,
// a severity, a static path that names the offending field, and a static
// message. Messages are fixed text per code and never contain a product value,
// a description, or a URL; the path can only contain field names and array
// indices (a path that could carry a raw value is refused). The only value an
// issue may carry is the offerId, and only when it is itself a valid SKU.
//
// Pure: no I/O, no clock, no randomness, no locale.

import type { MerchantGtinErrorCode } from "./gtin";
import type { IdentifierErrorCode } from "./identifiers";
import { validateOfferId } from "./identifiers";
import type { MoneyErrorCode } from "./money";
import type { TextErrorCode } from "./text";
import type { UrlErrorCode } from "./urls";

// Codes produced by the Slice 1 utilities. Over-long text is reported by the
// mapper with a field-specific code, so `text_too_long` is not among them.
export type Slice1IssueCode =
  | Exclude<TextErrorCode, "text_too_long">
  | MoneyErrorCode
  | IdentifierErrorCode
  | MerchantGtinErrorCode
  | UrlErrorCode;

export const MAPPER_ISSUE_CODES = [
  "missing_required_field",
  "variant_product_mismatch",
  "invalid_enum_value",
  "invalid_item_group_id",
  "feed_label_too_long",
  "title_too_long",
  "description_too_long",
  "attribute_too_long",
  "too_many_images",
  "missing_image",
  "invalid_compare_at_price",
  "missing_availability_date",
  "invalid_availability_date",
  "missing_identifier",
  "mpn_requires_brand",
  "too_many_size_types",
  "unreadable_input",
  "duplicate_offer_id",
  "variant_not_distinguishable",
  "mixed_currencies",
  "gtin_without_brand",
  "availability_date_ignored",
  "unmapped_attribute",
] as const;

export type MapperIssueCode = (typeof MAPPER_ISSUE_CODES)[number];

export type MerchantIssueCode = Slice1IssueCode | MapperIssueCode;

export type MerchantIssueSeverity = "error" | "warning";

// Codes that do not block mapping.
export const WARNING_ISSUE_CODES: readonly MapperIssueCode[] = [
  "gtin_without_brand",
  "availability_date_ignored",
  "unmapped_attribute",
];

export const ISSUE_MESSAGES: Readonly<Record<MapperIssueCode, string>> = {
  missing_required_field: "a required field is missing",
  variant_product_mismatch: "the variant does not belong to the given product",
  invalid_enum_value: "a value is not one of the allowed options",
  invalid_item_group_id: "the product id cannot be used as an itemGroupId (1-50 characters, no control characters)",
  feed_label_too_long: "feedLabel must be at most 20 characters",
  title_too_long: "the title is longer than 150 code points",
  description_too_long: "the description is longer than 5000 code points",
  attribute_too_long: "an attribute is longer than its maximum length",
  too_many_images: "more than 10 additional images are not allowed",
  missing_image: "at least one image is required",
  invalid_compare_at_price: "compareAtPriceAmount must be greater than priceAmount",
  missing_availability_date: "preorder and backorder offers require an availability date",
  invalid_availability_date: "the availability date is not a valid date",
  missing_identifier: "at least one of gtin or mpn is required",
  mpn_requires_brand: "an mpn requires a brand",
  too_many_size_types: "at most two size types are allowed",
  unreadable_input: "the input could not be read",
  duplicate_offer_id: "another offer in this batch has the same offerId, contentLanguage, and feedLabel",
  variant_not_distinguishable: "another variant of this product has the same color and size",
  mixed_currencies: "variants of one product use different currencies",
  gtin_without_brand: "a gtin is provided without a brand",
  availability_date_ignored: "the availability date is ignored unless the offer is a preorder or backorder",
  unmapped_attribute: "an attribute has no Merchant equivalent and was left out",
};

export interface MerchantIssue {
  readonly code: MerchantIssueCode;
  readonly severity: MerchantIssueSeverity;
  // Field names and array indices only, for example "variant.gtin" or "product.images[2]".
  readonly path: string;
  readonly message: string;
  // Present only when it is a valid SKU.
  readonly offerId?: string;
}

const SAFE_PATH = /^[A-Za-z][A-Za-z0-9_.[\]]*$/;
const MAX_PATH_LENGTH = 80;

// A path is built from static field names and indices. Refusing anything else
// guarantees a raw value can never travel inside a path.
function checkPath(path: string): string {
  if (path.length > MAX_PATH_LENGTH || !SAFE_PATH.test(path)) {
    throw new RangeError("issue path must contain only field names and indices");
  }
  return path;
}

// The offerId is echoed only when it is a valid SKU (1-50 code points, no
// separators, whitespace, or control characters), so an invalid raw value is
// never carried in an issue.
export function safeOfferId(value: unknown): string | undefined {
  const result = validateOfferId(value);
  return result.ok ? result.value : undefined;
}

function withOfferId(issue: MerchantIssue, offerId: unknown): MerchantIssue {
  const safe = safeOfferId(offerId);
  return safe === undefined ? issue : { ...issue, offerId: safe };
}

export function createIssue(code: MapperIssueCode, path: string, offerId?: unknown): MerchantIssue {
  const severity: MerchantIssueSeverity = WARNING_ISSUE_CODES.includes(code) ? "warning" : "error";
  return withOfferId({ code, severity, path: checkPath(path), message: ISSUE_MESSAGES[code] }, offerId);
}

// Converts a Slice 1 failure (whose message is already static and value-free).
export function issueFromFailure(
  failure: { readonly code: Slice1IssueCode; readonly message: string },
  path: string,
  offerId?: unknown,
): MerchantIssue {
  return withOfferId(
    { code: failure.code, severity: "error", path: checkPath(path), message: failure.message },
    offerId,
  );
}

export function errorsOf(issues: readonly MerchantIssue[]): MerchantIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}

export function warningsOf(issues: readonly MerchantIssue[]): MerchantIssue[] {
  return issues.filter((issue) => issue.severity === "warning");
}

export function hasErrors(issues: readonly MerchantIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

export interface IssueSummaryEntry {
  readonly code: MerchantIssueCode;
  readonly severity: MerchantIssueSeverity;
  readonly path: string;
  readonly offerId?: string;
}

export interface IssueSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly entries: readonly IssueSummaryEntry[];
}

// A log-safe view: code, severity, path, counts, and the (valid) offerId. No
// message text, product data, descriptions, or URLs.
export function summarizeIssues(issues: readonly MerchantIssue[]): IssueSummary {
  const entries = issues.map((issue): IssueSummaryEntry => {
    const base = { code: issue.code, severity: issue.severity, path: issue.path };
    return issue.offerId === undefined ? base : { ...base, offerId: issue.offerId };
  });
  return {
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    entries,
  };
}
