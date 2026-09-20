// Pure text helpers for the Google Merchant adapter (Slice 1).
//
// Only two transformations are ever applied to text: canonical (NFC) Unicode
// composition and trimming of surrounding whitespace. Case is never changed,
// text is never truncated, and no compatibility mapping is applied, so the
// output is deterministic and every change is explainable.
//
// Lengths are counted in Unicode code points, not UTF-16 code units, so an
// emoji counts as one and a decomposed accent counts after composition.
//
// Invalid external input never throws; it yields a structured failure with a
// static message that never echoes the input. A misuse by the caller (an
// invalid length limit) is a programmer error and does throw a RangeError.

export type TextErrorCode =
  | "invalid_text"
  | "malformed_unicode"
  | "text_empty"
  | "text_too_long";

export interface TextFailure {
  readonly ok: false;
  readonly code: TextErrorCode;
  readonly message: string;
}

export type TextResult =
  | { readonly ok: true; readonly value: string }
  | TextFailure;

export type BoundedTextResult =
  | { readonly ok: true; readonly value: string; readonly codePoints: number }
  | TextFailure;

const MESSAGES: Readonly<Record<TextErrorCode, string>> = {
  invalid_text: "text must be a string",
  malformed_unicode: "text contains malformed Unicode (an unpaired surrogate)",
  text_empty: "text must not be empty",
  text_too_long: "text exceeds the maximum length",
};

function fail(code: TextErrorCode): TextFailure {
  return { ok: false, code, message: MESSAGES[code] };
}

// Merchant limits, counted in code points (product data specification).
export const TITLE_MAX_CODE_POINTS = 150;
export const DESCRIPTION_MAX_CODE_POINTS = 5000;

// A high surrogate not followed by a low one, or a low surrogate not preceded
// by a high one. Such text cannot be encoded as UTF-8.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function hasLoneSurrogate(value: string): boolean {
  return LONE_SURROGATE.test(value);
}

// Array.from iterates by code point, so a surrogate pair counts once.
export function countCodePoints(value: string): number {
  return Array.from(value).length;
}

export function normalizeText(value: unknown): TextResult {
  if (typeof value !== "string") return fail("invalid_text");
  if (hasLoneSurrogate(value)) return fail("malformed_unicode");
  return { ok: true, value: value.normalize("NFC").trim() };
}

// Normalizes, then requires non-empty text of at most `maxCodePoints` code
// points. Over-long text is rejected, never shortened.
export function normalizeBoundedText(value: unknown, maxCodePoints: number): BoundedTextResult {
  if (!Number.isSafeInteger(maxCodePoints) || maxCodePoints < 1) {
    throw new RangeError("maxCodePoints must be a positive safe integer");
  }
  const normalized = normalizeText(value);
  if (!normalized.ok) return normalized;
  if (normalized.value.length === 0) return fail("text_empty");
  const codePoints = countCodePoints(normalized.value);
  if (codePoints > maxCodePoints) return fail("text_too_long");
  return { ok: true, value: normalized.value, codePoints };
}
