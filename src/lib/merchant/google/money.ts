// Exact price conversion for the Google Merchant adapter (Slice 1).
//
// Merchant expresses a price as `amountMicros`, an int64 of millionths of the
// currency unit, sent as a JSON string. Every calculation here is BigInt
// integer arithmetic: there is no floating-point arithmetic, no rounding, and
// no conversion of a price through a JavaScript number. (Floating point is
// unsafe for money: 1.005 * 1e6 is 1004999.9999999999.)
//
// v0.1 supports exactly EUR and TRY, both with two minor-unit digits. The
// canonical model accepts any three-letter uppercase code; this allowlist is
// this adapter's own boundary (ADR 0003 D7). Malformed and well-formed but
// unsupported currencies are reported separately.
//
// Invalid external input never throws; it yields a structured failure whose
// static message never echoes the input.

export const SUPPORTED_CURRENCIES = ["EUR", "TRY"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export type MoneyErrorCode =
  | "invalid_currency"
  | "unsupported_currency"
  | "price_not_an_integer"
  | "price_not_safe_integer"
  | "price_zero_not_allowed"
  | "price_negative"
  | "price_not_a_decimal"
  | "price_too_many_decimals"
  | "price_out_of_range";

export interface MoneyFailure {
  readonly ok: false;
  readonly code: MoneyErrorCode;
  readonly message: string;
}

export type MoneyResult<T> = { readonly ok: true; readonly value: T } | MoneyFailure;

const MESSAGES: Readonly<Record<MoneyErrorCode, string>> = {
  invalid_currency: "currency must be exactly three uppercase ASCII letters",
  unsupported_currency: "currency is not supported by the Google Merchant adapter (EUR and TRY only)",
  price_not_an_integer: "price must be an integer number of minor units",
  price_not_safe_integer: "price must be a safe integer",
  price_zero_not_allowed: "price must be greater than zero",
  price_negative: "price must not be negative",
  price_not_a_decimal: "price must be an unsigned plain decimal number",
  price_too_many_decimals: "price has more decimal places than the currency allows",
  price_out_of_range: "price is too large to represent as amountMicros",
};

function fail(code: MoneyErrorCode): MoneyFailure {
  return { ok: false, code, message: MESSAGES[code] };
}

// Minor-unit digits (ISO 4217 exponent) per supported currency.
const MINOR_UNIT_DIGITS: Readonly<Record<SupportedCurrency, number>> = { EUR: 2, TRY: 2 };

// amountMicros is millionths of a unit.
const MICROS_DIGITS = 6;

// amountMicros is an int64.
const INT64_MAX = 9223372036854775807n;

// No valid price needs this many characters; longer input is refused before
// any conversion work is done.
const MAX_DECIMAL_STRING_LENGTH = 64;

const CURRENCY_SHAPE = /^[A-Z]{3}$/;
const DECIMAL_SHAPE = /^([0-9]+)(?:\.([0-9]+))?$/;

export function currencyExponent(currency: SupportedCurrency): number {
  return MINOR_UNIT_DIGITS[currency];
}

export function validateCurrency(code: unknown): MoneyResult<SupportedCurrency> {
  if (typeof code !== "string" || !CURRENCY_SHAPE.test(code)) return fail("invalid_currency");
  if (code === "EUR" || code === "TRY") return { ok: true, value: code };
  return fail("unsupported_currency");
}

function minorToMicros(minor: bigint, currency: SupportedCurrency): MoneyResult<string> {
  const micros = minor * 10n ** BigInt(MICROS_DIGITS - MINOR_UNIT_DIGITS[currency]);
  if (micros > INT64_MAX) return fail("price_out_of_range");
  return { ok: true, value: micros.toString() };
}

// Converts an integer number of minor units (for example cents) to amountMicros.
// The currency is validated first.
export function minorUnitsToMicros(priceAmount: unknown, currency: unknown): MoneyResult<string> {
  const validated = validateCurrency(currency);
  if (!validated.ok) return validated;

  if (typeof priceAmount !== "number" || !Number.isInteger(priceAmount)) {
    return fail("price_not_an_integer");
  }
  if (!Number.isSafeInteger(priceAmount)) return fail("price_not_safe_integer");
  if (priceAmount < 0) return fail("price_negative");
  if (priceAmount === 0) return fail("price_zero_not_allowed");

  return minorToMicros(BigInt(priceAmount), validated.value);
}

// Converts an unsigned plain decimal string (for example "19.99") to
// amountMicros by splitting the string; the text is never parsed as a number.
// Signs, exponent notation, surrounding whitespace, separators, and more
// decimal places than the currency allows are rejected, never rounded away.
export function decimalStringToMicros(value: unknown, currency: unknown): MoneyResult<string> {
  const validated = validateCurrency(currency);
  if (!validated.ok) return validated;

  if (typeof value !== "string") return fail("price_not_a_decimal");
  const match = DECIMAL_SHAPE.exec(value);
  if (match === null) return fail("price_not_a_decimal");

  const digits = MINOR_UNIT_DIGITS[validated.value];
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > digits) return fail("price_too_many_decimals");
  if (value.length > MAX_DECIMAL_STRING_LENGTH) return fail("price_out_of_range");

  const minor = BigInt(whole + fraction + "0".repeat(digits - fraction.length));
  if (minor === 0n) return fail("price_zero_not_allowed");

  return minorToMicros(minor, validated.value);
}
