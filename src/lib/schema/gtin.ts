import { z } from "zod";

// GTIN validation for the canonical model.
//
// A GTIN is validated exactly as supplied: 8, 12, 13, or 14 digits with a
// valid GS1 check digit. It is never trimmed, stripped of spaces or dashes,
// or zero-padded, because rewriting an identifier would silently change what
// the unique index compares. Channel-specific normalization, if any, belongs
// to that channel's adapter.

const VALID_LENGTHS = new Set([8, 12, 13, 14]);

export type GtinProblem = "not_digits" | "bad_length" | "all_zeros" | "bad_check_digit";

export function gtinProblem(value: string): GtinProblem | null {
  if (!/^[0-9]+$/.test(value)) return "not_digits";
  if (!VALID_LENGTHS.has(value.length)) return "bad_length";
  if (/^0+$/.test(value)) return "all_zeros";

  const digits = Array.from(value, Number);
  const checkDigit = digits[digits.length - 1] ?? -1;
  let sum = 0;
  // Weights 3, 1, 3, 1, ... start at the digit immediately left of the check digit.
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += (digits[i] ?? 0) * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === checkDigit ? null : "bad_check_digit";
}

export function isValidGtin(value: string): boolean {
  return gtinProblem(value) === null;
}

const MESSAGES: Record<GtinProblem, string> = {
  not_digits: "GTIN must contain digits only (it is never trimmed or stripped)",
  bad_length: "GTIN must be exactly 8, 12, 13, or 14 digits (it is never zero-padded)",
  all_zeros: "GTIN must not be all zeros",
  bad_check_digit: "GTIN has an invalid GS1 check digit",
};

export const GtinSchema = z.string().superRefine((value, ctx) => {
  const problem = gtinProblem(value);
  if (problem !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: MESSAGES[problem] });
  }
});
