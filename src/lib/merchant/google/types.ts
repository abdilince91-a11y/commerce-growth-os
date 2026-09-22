// Types for the Google Merchant payload mapper (Slice 2). Types only: this
// module has no runtime code.
//
// The payload shape follows the Merchant API v1 `ProductInput` and
// `ProductAttributes` definitions in Google's discovery document
// (https://merchantapi.googleapis.com/$discovery/rest?version=products_v1,
// revision 20260910), verified when this slice was written. Only the subset of
// fields that the canonical model can supply is modeled here.
//
// Nothing here talks to Google: there is no client, transport, or credential.

import type { ProductRecord } from "@/lib/schema/product";
import type { VariantRecord } from "@/lib/schema/variant";
import type { MerchantIssue } from "./errors";
import type { SupportedCurrency } from "./money";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// Merchant channel configuration. Not product data: it says which language and
// feed label the offer is published under.
export interface MerchantChannelConfig {
  readonly contentLanguage: string; // two lowercase ASCII letters, e.g. "tr"
  readonly feedLabel: string; // A-Z, 0-9, "-", "_"; at most 20 characters, e.g. "TR"
}

// One offer is one Variant together with its parent Product. Both are canonical
// records, so they carry their stable ids: Product.id becomes itemGroupId
// verbatim, and Variant.productId must equal Product.id.
export interface MerchantOfferInput {
  readonly product: ProductRecord;
  readonly variant: VariantRecord;
  readonly channel: MerchantChannelConfig;
  // The finished landing-page URL from the storefront. The mapper validates it
  // and never derives it (for example from Product.handle).
  readonly link: string;
}

// ---------------------------------------------------------------------------
// Payload: Merchant API v1 ProductInput (subset)
// ---------------------------------------------------------------------------

// Google enum spellings (uppercase). Canonical lowercase values are mapped to
// these by explicit tables in mapper.ts.
export type MerchantAvailability = "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER" | "BACKORDER";
export type MerchantCondition = "NEW" | "USED" | "REFURBISHED";
export type MerchantGender = "MALE" | "FEMALE" | "UNISEX";
export type MerchantAgeGroup = "NEWBORN" | "INFANT" | "TODDLER" | "KIDS" | "ADULT";
export type MerchantSizeSystem =
  | "US"
  | "UK"
  | "EU"
  | "DE"
  | "FR"
  | "JP"
  | "CN"
  | "IT"
  | "BR"
  | "MEX"
  | "AU";
// `sizeTypes` items are the API's SizeType enum (at most two values). The API's
// `BIG` is not listed: the canonical model has no value that maps to it.
export type MerchantSizeType = "REGULAR" | "PETITE" | "PLUS" | "TALL" | "MATERNITY";

// `Price`: amountMicros is an int64 and is therefore a JSON string.
export interface MerchantPrice {
  readonly amountMicros: string;
  readonly currencyCode: SupportedCurrency;
}

export interface MerchantProductAttributes {
  readonly title: string;
  readonly description: string;
  readonly link: string;
  readonly imageLink: string;
  readonly additionalImageLinks?: readonly string[];
  // Regular price. When the variant has a compare-at price this is that value.
  readonly price: MerchantPrice;
  // Present only when a compare-at price exists: the current (sale) price.
  readonly salePrice?: MerchantPrice;
  readonly availability: MerchantAvailability;
  // RFC 3339 / ISO 8601 UTC timestamp; present only for PREORDER and BACKORDER.
  readonly availabilityDate?: string;
  readonly condition: MerchantCondition;
  readonly gtins?: readonly string[];
  readonly mpn?: string;
  readonly brand?: string;
  readonly itemGroupId: string;
  readonly color?: string;
  // A single value: Merchant allows one size per product input.
  readonly size?: string;
  readonly material?: string;
  readonly pattern?: string;
  readonly gender?: MerchantGender;
  readonly ageGroup?: MerchantAgeGroup;
  readonly sizeSystem?: MerchantSizeSystem;
  readonly sizeTypes?: readonly MerchantSizeType[];
}

// The request body of `accounts.productInputs.insert`. The account and data
// source are transport concerns and are not modeled here.
export interface MerchantProductInput {
  readonly offerId: string;
  readonly contentLanguage: string;
  readonly feedLabel: string;
  readonly productAttributes: MerchantProductAttributes;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

// A valid, active offer: a payload preview plus its deterministic identifier.
export interface MappedOffer {
  readonly status: "mapped";
  // contentLanguage~feedLabel~offerId
  readonly productInputId: string;
  readonly productInput: MerchantProductInput;
  // Non-blocking issues (severity "warning").
  readonly warnings: readonly MerchantIssue[];
  readonly productId: string;
  readonly variantId: string;
}

// A draft or archived record: intentionally not published, and not an error.
export type SkipReason =
  | "product_draft"
  | "product_archived"
  | "variant_draft"
  | "variant_archived";

export interface SkippedOffer {
  readonly status: "skipped";
  readonly reason: SkipReason;
  readonly productId: string;
  readonly variantId: string;
}

// An active offer that cannot be mapped. `issues` holds every problem found
// (errors and warnings) and always contains at least one error.
export interface InvalidOffer {
  readonly status: "invalid";
  readonly issues: readonly MerchantIssue[];
  // Present only when the identifier components were themselves valid.
  readonly productInputId?: string;
  readonly productId?: string;
  readonly variantId?: string;
}

export type MapOfferResult = MappedOffer | SkippedOffer | InvalidOffer;

export interface BatchMapResult {
  // Sorted by productInputId.
  readonly mapped: readonly MappedOffer[];
  readonly skipped: readonly SkippedOffer[];
  readonly invalid: readonly InvalidOffer[];
}
