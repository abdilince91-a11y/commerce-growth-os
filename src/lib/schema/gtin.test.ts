import { describe, expect, it } from "vitest";
import { GtinSchema, gtinProblem, isValidGtin } from "./gtin";
import { GTIN_12, GTIN_13, GTIN_14, GTIN_8 } from "./test-fixtures";

describe("GTIN validation", () => {
  it.each([
    ["GTIN-8", GTIN_8],
    ["GTIN-12", GTIN_12],
    ["GTIN-13", GTIN_13],
    ["GTIN-14", GTIN_14],
  ])("accepts a valid %s and returns it unchanged", (_name, gtin) => {
    expect(isValidGtin(gtin)).toBe(true);
    expect(GtinSchema.parse(gtin)).toBe(gtin);
  });

  it("rejects a wrong check digit", () => {
    expect(gtinProblem("0012345678906")).toBe("bad_check_digit");
    expect(GtinSchema.safeParse("0012345678906").success).toBe(false);
  });

  it.each(["1234567", "123456789", "1234567890", "12345678901", "123456789012345"])(
    "rejects length %s (only 8, 12, 13, 14 are valid)",
    (gtin) => {
      expect(gtinProblem(gtin)).toBe("bad_length");
    },
  );

  it.each([
    ["leading space", " 0012345678905"],
    ["trailing space", "0012345678905 "],
    ["dashes", "0012-3456-78905"],
    ["inner space", "0012 345678905"],
    ["letter O instead of zero", "00123456789O5"],
    ["empty string", ""],
  ])("rejects non-digit input without stripping it: %s", (_name, gtin) => {
    expect(gtinProblem(gtin)).toBe("not_digits");
  });

  it("rejects all-zero values even when the checksum would pass", () => {
    expect(gtinProblem("00000000")).toBe("all_zeros");
    expect(gtinProblem("000000000000")).toBe("all_zeros");
  });

  it("never zero-pads: a GTIN-12 and its padded GTIN-13 are two distinct valid strings", () => {
    expect(GtinSchema.parse(GTIN_12)).toBe(GTIN_12);
    expect(GtinSchema.parse(GTIN_13)).toBe(GTIN_13);
    expect(GTIN_12).not.toBe(GTIN_13);
  });

  it("does not repair a GTIN whose leading zero was dropped", () => {
    // 11 digits: GTIN-12 "012345678905" with the leading zero removed.
    expect(GtinSchema.safeParse("12345678905").success).toBe(false);
  });

  it("reports a human-readable message", () => {
    const result = GtinSchema.safeParse("0012345678906");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/check digit/);
    }
  });
});
