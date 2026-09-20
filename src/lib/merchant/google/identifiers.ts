// Merchant identifiers for the Google Merchant adapter (Slice 1).
//
//   productInputId = contentLanguage~feedLabel~offerId
//
// offerId is Variant.sku (ADR 0003 D4). contentLanguage and feedLabel are
// Merchant channel configuration, not product data. `~` separates the parts, so
// no part may contain it; an invalid component is reported and never escaped,
// trimmed, normalized, or otherwise rewritten. The result depends only on its
// three inputs: no clock, locale, or randomness.
//
// Invalid external input never throws; it yields a structured failure whose
// static message never echoes the input.

import { countCodePoints } from "./text";

export type IdentifierErrorCode =
  | "invalid_offer_id"
  | "invalid_content_language"
  | "invalid_feed_label";

export interface IdentifierFailure {
  readonly ok: false;
  readonly code: IdentifierErrorCode;
  readonly message: string;
}

export type IdentifierResult<T> = { readonly ok: true; readonly value: T } | IdentifierFailure;

export interface IdentifierIssue {
  readonly field: "contentLanguage" | "feedLabel" | "offerId";
  readonly code: IdentifierErrorCode;
  readonly message: string;
}

export type ProductInputIdResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly issues: readonly IdentifierIssue[] };

const MESSAGES: Readonly<Record<IdentifierErrorCode, string>> = {
  invalid_offer_id:
    "offerId must be 1-50 characters with no ~, /, %, whitespace, or control characters",
  invalid_content_language: "contentLanguage must be exactly two lowercase ASCII letters",
  invalid_feed_label:
    "feedLabel must be one or more uppercase ASCII letters, digits, hyphens, or underscores",
};

function fail(code: IdentifierErrorCode): IdentifierFailure {
  return { ok: false, code, message: MESSAGES[code] };
}

const OFFER_ID_MIN_CODE_POINTS = 1;
const OFFER_ID_MAX_CODE_POINTS = 50;

// ~ / % separators and reserved characters, any Unicode whitespace, control
// characters (C0, DEL, C1), and unpaired surrogates.
const FORBIDDEN_OFFER_ID_CHARACTER = /[~/%\s\p{Cc}\p{Cs}]/u;

const CONTENT_LANGUAGE = /^[a-z]{2}$/;
const FEED_LABEL = /^[A-Z0-9_-]+$/;

// Validates a Variant.sku for use as a Merchant offerId. Length is counted in
// code points (1-50). The value is returned exactly as supplied.
export function validateOfferId(value: unknown): IdentifierResult<string> {
  if (typeof value !== "string") return fail("invalid_offer_id");
  // A code point is at most two UTF-16 units, so anything longer than 100 units
  // has more than 50 code points; this avoids counting a huge string.
  if (value.length > OFFER_ID_MAX_CODE_POINTS * 2) return fail("invalid_offer_id");
  const length = countCodePoints(value);
  if (length < OFFER_ID_MIN_CODE_POINTS || length > OFFER_ID_MAX_CODE_POINTS) {
    return fail("invalid_offer_id");
  }
  if (FORBIDDEN_OFFER_ID_CHARACTER.test(value)) return fail("invalid_offer_id");
  return { ok: true, value };
}

// Exactly two lowercase ASCII letters (for example "tr" or "en").
export function validateContentLanguage(value: unknown): IdentifierResult<string> {
  if (typeof value !== "string" || !CONTENT_LANGUAGE.test(value)) {
    return fail("invalid_content_language");
  }
  return { ok: true, value };
}

// Uppercase ASCII letters, digits, hyphens, and underscores only (so it can
// never contain `~`).
export function validateFeedLabel(value: unknown): IdentifierResult<string> {
  if (typeof value !== "string" || !FEED_LABEL.test(value)) return fail("invalid_feed_label");
  return { ok: true, value };
}

// Builds contentLanguage~feedLabel~offerId. Every invalid component is
// reported, in the fixed order contentLanguage, feedLabel, offerId.
export function buildProductInputId(parts: {
  readonly contentLanguage: unknown;
  readonly feedLabel: unknown;
  readonly offerId: unknown;
}): ProductInputIdResult {
  const contentLanguage = validateContentLanguage(parts.contentLanguage);
  const feedLabel = validateFeedLabel(parts.feedLabel);
  const offerId = validateOfferId(parts.offerId);

  if (contentLanguage.ok && feedLabel.ok && offerId.ok) {
    return { ok: true, value: `${contentLanguage.value}~${feedLabel.value}~${offerId.value}` };
  }

  const issues: IdentifierIssue[] = [];
  if (!contentLanguage.ok) {
    issues.push({ field: "contentLanguage", code: contentLanguage.code, message: contentLanguage.message });
  }
  if (!feedLabel.ok) {
    issues.push({ field: "feedLabel", code: feedLabel.code, message: feedLabel.message });
  }
  if (!offerId.ok) {
    issues.push({ field: "offerId", code: offerId.code, message: offerId.message });
  }
  return { ok: false, issues };
}
