// GTIN validation for the Google Merchant adapter (Slice 1).
//
// Follows accepted ADR 0003 D17: a GTIN is validated exactly as supplied. It
// must be 8, 12, 13, or 14 ASCII digits with a valid GS1 check digit, all-zero
// values are rejected, and it is never trimmed, stripped of spaces or dashes,
// zero-padded, or otherwise rewritten. The checksum rules are shared with the
// canonical schema (src/lib/schema/gtin.ts) so the two cannot drift.
//
// On top of the canonical rules this adapter rejects coupon prefixes, which
// cannot identify a product: 98 or 99 at the start of a 13-digit GTIN, or at
// the start of the embedded GTIN-13 of a 14-digit GTIN (after the indicator
// digit). They do not apply to GTIN-8 or GTIN-12.
//
// Invalid external input never throws; it yields a structured failure whose
// static message never echoes the input.

import { gtinProblem } from "@/lib/schema/gtin";

export type MerchantGtinErrorCode =
  | "gtin_not_a_string"
  | "gtin_not_digits"
  | "gtin_bad_length"
  | "gtin_all_zeros"
  | "gtin_bad_check_digit"
  | "gtin_coupon_prefix";

export interface GtinFailure {
  readonly ok: false;
  readonly code: MerchantGtinErrorCode;
  readonly message: string;
}

export type GtinResult = { readonly ok: true; readonly value: string } | GtinFailure;

const MESSAGES: Readonly<Record<MerchantGtinErrorCode, string>> = {
  gtin_not_a_string: "GTIN must be a string",
  gtin_not_digits: "GTIN must contain ASCII digits only (it is never trimmed or stripped)",
  gtin_bad_length: "GTIN must be exactly 8, 12, 13, or 14 digits (it is never zero-padded)",
  gtin_all_zeros: "GTIN must not be all zeros",
  gtin_bad_check_digit: "GTIN has an invalid GS1 check digit",
  gtin_coupon_prefix: "GTIN uses a coupon prefix (98 or 99) and cannot identify a product",
};

function fail(code: MerchantGtinErrorCode): GtinFailure {
  return { ok: false, code, message: MESSAGES[code] };
}

const CANONICAL_TO_MERCHANT = {
  not_digits: "gtin_not_digits",
  bad_length: "gtin_bad_length",
  all_zeros: "gtin_all_zeros",
  bad_check_digit: "gtin_bad_check_digit",
} as const;

// Assumes `gtin` is already a valid digit string of an accepted length.
export function hasCouponPrefix(gtin: string): boolean {
  if (gtin.length === 13) return /^9[89]/.test(gtin);
  if (gtin.length === 14) return /^[0-9]9[89]/.test(gtin);
  return false;
}

export function validateGtin(value: unknown): GtinResult {
  if (typeof value !== "string") return fail("gtin_not_a_string");

  const problem = gtinProblem(value);
  if (problem !== null) return fail(CANONICAL_TO_MERCHANT[problem]);
  if (hasCouponPrefix(value)) return fail("gtin_coupon_prefix");

  return { ok: true, value };
}
