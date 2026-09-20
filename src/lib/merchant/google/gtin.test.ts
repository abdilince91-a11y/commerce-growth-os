import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gtinProblem } from "@/lib/schema/gtin";
import { hasCouponPrefix, validateGtin } from "./gtin";

const CANARY = "SECRET-CANARY-9052";

// Checksum-valid GS1 examples.
const GTIN_8 = "96385074";
const GTIN_12 = "012345678905";
const GTIN_13 = "0012345678905";
const GTIN_14 = "10012345678902";

// Test-only helper: build a checksum-valid GTIN from a payload (independent of the code under test).
function withCheckDigit(payload: string): string {
  let sum = 0;
  for (let i = payload.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(payload[i]) * weight;
  }
  return payload + String((10 - (sum % 10)) % 10);
}

function failureOf<T extends { ok: boolean }>(result: T) {
  expect(result.ok).toBe(false);
  return result as Extract<T, { ok: false }>;
}

describe("validateGtin: accepted values (exactly as supplied)", () => {
  it.each([
    ["GTIN-8", GTIN_8],
    ["GTIN-12", GTIN_12],
    ["GTIN-13", GTIN_13],
    ["GTIN-14", GTIN_14],
  ])("accepts a valid %s and returns it unchanged", (_name, gtin) => {
    expect(validateGtin(gtin)).toEqual({ ok: true, value: gtin });
  });

  it("keeps a GTIN-12 and its zero-padded GTIN-13 as two distinct valid strings", () => {
    expect(validateGtin(GTIN_12)).toEqual({ ok: true, value: GTIN_12 });
    expect(validateGtin(GTIN_13)).toEqual({ ok: true, value: GTIN_13 });
    expect(GTIN_12).not.toBe(GTIN_13);
  });
});

describe("validateGtin: never rewrites its input", () => {
  it.each([
    ["leading space", ` ${GTIN_13}`],
    ["trailing space", `${GTIN_13} `],
    ["inner space", "0012 345678905"],
    ["dashes", "0012-3456-78905"],
    ["tab", `${GTIN_13}\t`],
    ["newline", `${GTIN_13}\n`],
    ["no-break space", `${GTIN_13} `],
    ["letter O for zero", "00123456789O5"],
    ["full-width digits", "００１２３４５６７８９０５"],
    ["Arabic-Indic digits", "٠٠١٢٣٤٥٦٧٨٩٠٥"],
    ["empty", ""],
  ])("rejects %s instead of stripping it", (_name, gtin) => {
    expect(failureOf(validateGtin(gtin)).code).toBe("gtin_not_digits");
  });

  it("does not repair a GTIN whose leading zero was dropped", () => {
    expect(failureOf(validateGtin("12345678905")).code).toBe("gtin_bad_length"); // 11 digits
  });

  it("does not zero-pad a short value to a valid length", () => {
    // 7 digits: padding it to 8 is never attempted, it simply fails on length.
    expect(failureOf(validateGtin("1234567")).code).toBe("gtin_bad_length");
    expect(failureOf(validateGtin("385074")).code).toBe("gtin_bad_length");
  });
});

describe("validateGtin: rejections", () => {
  it.each(["1234567", "123456789", "1234567890", "12345678901", "123456789012345", "1234567890123456"])(
    "rejects length %s (only 8, 12, 13 and 14 are valid)",
    (gtin) => {
      expect(failureOf(validateGtin(gtin)).code).toBe("gtin_bad_length");
    },
  );

  it.each(["00000000", "000000000000", "0000000000000", "00000000000000"])(
    "rejects the all-zero identifier %s",
    (gtin) => {
      expect(failureOf(validateGtin(gtin)).code).toBe("gtin_all_zeros");
    },
  );

  it("rejects a wrong check digit for every valid length", () => {
    for (const valid of [GTIN_8, GTIN_12, GTIN_13, GTIN_14]) {
      const last = Number(valid.slice(-1));
      const wrong = `${valid.slice(0, -1)}${(last + 1) % 10}`;
      expect(failureOf(validateGtin(wrong)).code).toBe("gtin_bad_check_digit");
    }
  });

  it("rejects transposed digits", () => {
    expect(failureOf(validateGtin("0012345678095")).code).toBe("gtin_bad_check_digit");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 12345670],
    ["bigint", 12345670n],
    ["array", [GTIN_13]],
    ["object", { gtin: GTIN_13 }],
  ])("rejects a non-string: %s (never converted)", (_name, value) => {
    expect(failureOf(validateGtin(value)).code).toBe("gtin_not_a_string");
  });
});

describe("coupon prefixes 98 and 99", () => {
  it("rejects a valid 13-digit GTIN that starts with 98 or 99", () => {
    for (const prefix of ["98", "99"]) {
      const gtin = withCheckDigit(`${prefix}1234567890`);
      expect(gtin).toHaveLength(13);
      expect(hasCouponPrefix(gtin)).toBe(true);
      expect(failureOf(validateGtin(gtin)).code).toBe("gtin_coupon_prefix");
    }
  });

  it("applies to the embedded GTIN-13 of a GTIN-14 (after the indicator digit)", () => {
    for (const embedded of ["98", "99"]) {
      const gtin = withCheckDigit(`1${embedded}123456789`.padEnd(13, "0"));
      expect(gtin).toHaveLength(14);
      expect(failureOf(validateGtin(gtin)).code).toBe("gtin_coupon_prefix");
    }
  });

  it("does not misread a GTIN-14 indicator digit as part of the prefix", () => {
    const gtin = withCheckDigit("9812345678901");
    expect(gtin).toHaveLength(14);
    expect(gtin.startsWith("98")).toBe(true);
    expect(validateGtin(gtin)).toEqual({ ok: true, value: gtin });
  });

  it("does not apply to ordinary 13-digit prefixes", () => {
    for (const prefix of ["97", "09", "00", "40", "87", "89"]) {
      const gtin = withCheckDigit(`${prefix}1234567890`);
      expect(hasCouponPrefix(gtin)).toBe(false);
      expect(validateGtin(gtin)).toEqual({ ok: true, value: gtin });
    }
  });

  it("does not apply to GTIN-8 or GTIN-12", () => {
    const gtin8 = withCheckDigit("9812345");
    const gtin12 = withCheckDigit("98123456789");
    expect(gtin8).toHaveLength(8);
    expect(gtin12).toHaveLength(12);
    expect(validateGtin(gtin8)).toEqual({ ok: true, value: gtin8 });
    expect(validateGtin(gtin12)).toEqual({ ok: true, value: gtin12 });
  });

  it("reports a wrong check digit before a coupon prefix", () => {
    const coupon = withCheckDigit("981234567890");
    const wrong = `${coupon.slice(0, -1)}${(Number(coupon.slice(-1)) + 1) % 10}`;
    expect(failureOf(validateGtin(wrong)).code).toBe("gtin_bad_check_digit");
  });
});

describe("agreement with the canonical GTIN rules (ADR 0003 D17)", () => {
  // Deterministic pseudo-random corpus (no Math.random): a simple LCG.
  function corpus(): string[] {
    let seed = 20260920;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const values: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const length = 6 + (next() % 11); // 6..16
      let digits = "";
      for (let j = 0; j < length; j++) digits += String(next() % 10);
      values.push(digits);
      if (length >= 8) values.push(withCheckDigit(digits.slice(0, length - 1)));
    }
    return values;
  }

  it("accepts exactly what the canonical rules accept, minus coupon prefixes", () => {
    for (const value of corpus()) {
      const canonicalOk = gtinProblem(value) === null;
      const merchant = validateGtin(value);
      if (merchant.ok) {
        expect(canonicalOk, value).toBe(true);
        expect(hasCouponPrefix(value), value).toBe(false);
      } else if (canonicalOk) {
        expect(merchant.code, value).toBe("gtin_coupon_prefix");
      }
    }
  });

  it("maps every canonical problem to the same Merchant code", () => {
    const mapping: Record<string, string> = {
      not_digits: "gtin_not_digits",
      bad_length: "gtin_bad_length",
      all_zeros: "gtin_all_zeros",
      bad_check_digit: "gtin_bad_check_digit",
    };
    for (const value of [" 1", "123", "00000000", "0012345678906", "abc"]) {
      const problem = gtinProblem(value);
      expect(problem).not.toBeNull();
      expect(failureOf(validateGtin(value)).code).toBe(mapping[problem as string]);
    }
  });
});

describe("safety properties", () => {
  const hostile: unknown[] = [
    Symbol("x"),
    () => 1,
    { toString() { throw new Error("boom"); } },
    new Proxy({}, { get() { throw new Error("boom"); } }),
    "\u0000",
    CANARY,
    undefined,
  ];

  it("never throws on hostile input", () => {
    for (const input of hostile) {
      expect(() => validateGtin(input)).not.toThrow();
    }
  });

  it("never echoes the raw value in an error message", () => {
    for (const input of [CANARY, `${CANARY}123`, 12345678, null, "0".repeat(13), "0012345678906"]) {
      const failure = failureOf(validateGtin(input));
      expect(failure.message).not.toContain(CANARY);
      expect(failure.message).not.toMatch(/\d{6}/);
      expect(failure.message.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic and returns the same string it was given", () => {
    for (let i = 0; i < 3; i++) {
      const result = validateGtin(GTIN_13);
      expect(result).toEqual({ ok: true, value: GTIN_13 });
    }
  });

  it("has no I/O, network, clock, or randomness in its source", () => {
    const source = readFileSync(new URL("./gtin.ts", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const banned of [
      /\bfetch\s*\(/, /\brequire\s*\(/, /import\s*\(/, /from\s+["']node:/, /\bprocess\./,
      /Date\.now/, /new Date/, /Math\.random/, /\.trim\(/, /\.replace\(/, /\.padStart\(/, /\.padEnd\(/,
    ]) {
      expect(source).not.toMatch(banned);
    }
  });
});
