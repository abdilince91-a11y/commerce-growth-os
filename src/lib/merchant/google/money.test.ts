import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SUPPORTED_CURRENCIES,
  currencyExponent,
  decimalStringToMicros,
  minorUnitsToMicros,
  validateCurrency,
} from "./money";

const CANARY = "SECRET-CANARY-7731";

function failureOf<T extends { ok: boolean }>(result: T) {
  expect(result.ok).toBe(false);
  return result as Extract<T, { ok: false }>;
}

describe("supported currencies", () => {
  it("are exactly EUR and TRY, both with exponent 2", () => {
    expect([...SUPPORTED_CURRENCIES]).toEqual(["EUR", "TRY"]);
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("TRY")).toBe(2);
  });
});

describe("validateCurrency", () => {
  it.each(["EUR", "TRY"])("accepts %s", (code) => {
    expect(validateCurrency(code)).toEqual({ ok: true, value: code });
  });

  it.each(["USD", "JPY", "KWD", "GBP", "ZZZ"])(
    "reports well-formed but unsupported %s as unsupported_currency",
    (code) => {
      expect(failureOf(validateCurrency(code)).code).toBe("unsupported_currency");
    },
  );

  it.each([
    ["lowercase", "eur"],
    ["mixed case", "Eur"],
    ["two letters", "EU"],
    ["four letters", "EURO"],
    ["digit", "E1R"],
    ["symbol", "€UR"],
    ["non-ASCII letter", "ÉUR"],
    ["full-width letters", "ＥＵＲ"],
    ["trailing space", "EUR "],
    ["leading space", " EUR"],
    ["trailing newline", "EUR\n"],
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["number", 978],
    ["object", { code: "EUR" }],
  ])("reports %s as invalid_currency (malformed), not unsupported", (_name, code) => {
    expect(failureOf(validateCurrency(code)).code).toBe("invalid_currency");
  });

  it("keeps malformed and unsupported distinct", () => {
    expect(failureOf(validateCurrency("usd")).code).toBe("invalid_currency");
    expect(failureOf(validateCurrency("USD")).code).toBe("unsupported_currency");
  });
});

describe("minorUnitsToMicros (exact BigInt, string result)", () => {
  it.each([
    [1999, "EUR", "19990000"],
    [1999, "TRY", "19990000"],
    [1, "EUR", "10000"],
    [2147483647, "TRY", "21474836470000"],
    [999999999999, "EUR", "9999999999990000"],
    [100, "EUR", "1000000"],
    [50, "TRY", "500000"],
  ])("converts %s %s to %s", (amount, currency, expected) => {
    const result = minorUnitsToMicros(amount, currency);
    expect(result).toEqual({ ok: true, value: expected });
    expect(typeof (result as { value: unknown }).value).toBe("string");
  });

  it("returns a string even when the value exceeds Number.MAX_SAFE_INTEGER", () => {
    const result = minorUnitsToMicros(999999999999, "EUR");
    expect(result).toEqual({ ok: true, value: "9999999999990000" });
    expect(Number.isSafeInteger(Number("9999999999990000"))).toBe(false);
  });

  it("checks the currency before the amount", () => {
    expect(failureOf(minorUnitsToMicros(0, "USD")).code).toBe("unsupported_currency");
    expect(failureOf(minorUnitsToMicros(-5, "eur")).code).toBe("invalid_currency");
  });

  it("rejects zero", () => {
    expect(failureOf(minorUnitsToMicros(0, "EUR")).code).toBe("price_zero_not_allowed");
    expect(failureOf(minorUnitsToMicros(-0, "EUR")).code).toBe("price_zero_not_allowed");
  });

  it.each([-1, -1999, Number.MIN_SAFE_INTEGER + 1])("rejects negative %s", (amount) => {
    expect(failureOf(minorUnitsToMicros(amount, "EUR")).code).toBe("price_negative");
  });

  it.each([
    ["fractional", 12.5],
    ["tiny fraction", 0.1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["numeric string", "1999"],
    ["bigint", 1999n],
    ["null", null],
    ["undefined", undefined],
    ["boolean", true],
    ["object", {}],
    ["array", [1999]],
  ])("rejects a non-integer: %s", (_name, amount) => {
    expect(failureOf(minorUnitsToMicros(amount, "EUR")).code).toBe("price_not_an_integer");
  });

  it.each([
    ["2^53", 2 ** 53],
    ["MAX_SAFE_INTEGER + 1", Number.MAX_SAFE_INTEGER + 1],
    ["1e21", 1e21],
    ["-(2^53)", -(2 ** 53)],
  ])("rejects an unsafe integer: %s", (_name, amount) => {
    expect(failureOf(minorUnitsToMicros(amount, "EUR")).code).toBe("price_not_safe_integer");
  });

  it("rejects amounts whose micros do not fit a signed 64-bit integer", () => {
    // 922337203685477 * 10_000 = 9223372036854770000 <= 2^63 - 1
    expect(minorUnitsToMicros(922337203685477, "EUR")).toEqual({
      ok: true,
      value: "9223372036854770000",
    });
    // 922337203685478 * 10_000 = 9223372036854780000 > 2^63 - 1
    expect(failureOf(minorUnitsToMicros(922337203685478, "EUR")).code).toBe("price_out_of_range");
    expect(failureOf(minorUnitsToMicros(Number.MAX_SAFE_INTEGER, "TRY")).code).toBe(
      "price_out_of_range",
    );
  });
});

describe("decimalStringToMicros (exact, no parseFloat and no Number conversion)", () => {
  it.each([
    ["19.99", "EUR", "19990000"],
    ["19.99", "TRY", "19990000"],
    ["19.9", "EUR", "19900000"],
    ["19", "EUR", "19000000"],
    ["0.01", "EUR", "10000"],
    ["0.10", "EUR", "100000"],
    ["1", "EUR", "1000000"],
    ["0.29", "EUR", "290000"], // 0.29 * 100 is 28.999999999999996 in floating point
    ["4.35", "EUR", "4350000"], // 4.35 * 100 is 434.99999999999994 in floating point
    ["1.15", "TRY", "1150000"],
    ["0019.99", "EUR", "19990000"],
    ["9223372036854.77", "EUR", "9223372036854770000"],
  ])("converts %s %s to %s", (value, currency, expected) => {
    expect(decimalStringToMicros(value, currency)).toEqual({ ok: true, value: expected });
  });

  it("agrees with the minor-unit path for every price from 0.01 to 20.00", () => {
    for (let cents = 1; cents <= 2000; cents++) {
      const whole = Math.floor(cents / 100);
      const fraction = String(cents % 100).padStart(2, "0");
      const text = `${whole}.${fraction}`;
      const fromText = decimalStringToMicros(text, "EUR");
      const fromMinor = minorUnitsToMicros(cents, "EUR");
      expect(fromText).toEqual(fromMinor);
      expect(fromText).toEqual({ ok: true, value: String(cents * 10000) });
    }
  });

  it("checks the currency before the value", () => {
    expect(failureOf(decimalStringToMicros("19.99", "USD")).code).toBe("unsupported_currency");
    expect(failureOf(decimalStringToMicros("19.99", "eur")).code).toBe("invalid_currency");
  });

  it("rejects more decimal places than the currency allows, without rounding", () => {
    for (const value of ["19.999", "0.001", "1.005", "19.990", "19.100"]) {
      expect(failureOf(decimalStringToMicros(value, "EUR")).code).toBe("price_too_many_decimals");
    }
  });

  it("rejects zero", () => {
    for (const value of ["0", "0.0", "0.00", "00.00", "000"]) {
      expect(failureOf(decimalStringToMicros(value, "EUR")).code).toBe("price_zero_not_allowed");
    }
  });

  it.each([
    ["empty", ""],
    ["leading space", " 19.99"],
    ["trailing space", "19.99 "],
    ["trailing newline", "19.99\n"],
    ["plus sign", "+19.99"],
    ["minus sign", "-19.99"],
    ["lowercase exponent", "1e3"],
    ["uppercase exponent", "1E3"],
    ["decimal with exponent", "19.99e2"],
    ["hex", "0x10"],
    ["comma decimal", "19,99"],
    ["thousands separator", "1,999.00"],
    ["underscore", "1_000"],
    ["leading dot", ".5"],
    ["trailing dot", "5."],
    ["two dots", "1.2.3"],
    ["letters", "abc"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["Arabic-Indic digits", "١٢٣"],
    ["full-width digits", "１９.９９"],
    ["currency symbol", "€19.99"],
    ["number instead of string", 19.99],
    ["null", null],
    ["undefined", undefined],
    ["object", {}],
  ])("rejects a malformed decimal: %s", (_name, value) => {
    expect(failureOf(decimalStringToMicros(value, "EUR")).code).toBe("price_not_a_decimal");
  });

  it("rejects values whose micros do not fit a signed 64-bit integer", () => {
    expect(failureOf(decimalStringToMicros("9223372036854.78", "EUR")).code).toBe(
      "price_out_of_range",
    );
    expect(failureOf(decimalStringToMicros("99999999999999999999.99", "EUR")).code).toBe(
      "price_out_of_range",
    );
  });

  it("rejects absurdly long digit strings quickly instead of converting them", () => {
    const long = `1${"0".repeat(100000)}.00`;
    expect(failureOf(decimalStringToMicros(long, "EUR")).code).toBe("price_out_of_range");
  });
});

describe("safety properties", () => {
  const hostile: unknown[] = [
    Symbol("x"),
    () => 1,
    { valueOf() { throw new Error("boom"); }, toString() { throw new Error("boom"); } },
    new Proxy({}, { get() { throw new Error("boom"); } }),
    Number.NaN,
    "\u0000",
    CANARY,
  ];

  it("never throws on hostile input", () => {
    for (const input of hostile) {
      expect(() => validateCurrency(input)).not.toThrow();
      expect(() => minorUnitsToMicros(input, "EUR")).not.toThrow();
      expect(() => minorUnitsToMicros(1999, input)).not.toThrow();
      expect(() => decimalStringToMicros(input, "EUR")).not.toThrow();
      expect(() => decimalStringToMicros("19.99", input)).not.toThrow();
    }
  });

  it("never echoes the raw value in an error message", () => {
    const results = [
      validateCurrency(CANARY),
      validateCurrency(`${CANARY}X`),
      decimalStringToMicros(CANARY, "EUR"),
      decimalStringToMicros(`${CANARY}.99`, "EUR"),
      decimalStringToMicros("19.999", CANARY),
      minorUnitsToMicros(CANARY, "EUR"),
      minorUnitsToMicros(1999, CANARY),
    ];
    for (const result of results) {
      const failure = failureOf(result);
      expect(failure.message).not.toContain(CANARY);
      expect(failure.message.length).toBeGreaterThan(0);
    }
  });

  it("uses one static message per error code", () => {
    const a = failureOf(decimalStringToMicros("abc", "EUR"));
    const b = failureOf(decimalStringToMicros("xyz!", "EUR"));
    expect(a.code).toBe(b.code);
    expect(a.message).toBe(b.message);
  });

  it("is deterministic", () => {
    for (let i = 0; i < 3; i++) {
      expect(minorUnitsToMicros(1999, "EUR")).toEqual({ ok: true, value: "19990000" });
      expect(decimalStringToMicros("19.99", "TRY")).toEqual({ ok: true, value: "19990000" });
    }
  });

  it("uses no floating-point arithmetic or Number conversion in its source", () => {
    const source = readFileSync(new URL("./money.ts", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const banned of [/parseFloat/, /parseInt/, /\bNumber\(/, /\.toFixed/, /\bMath\./]) {
      expect(source).not.toMatch(banned);
    }
  });

  it("has no I/O, network, clock, or randomness in its source", () => {
    const source = readFileSync(new URL("./money.ts", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const banned of [/\bfetch\s*\(/, /\brequire\s*\(/, /import\s*\(/, /from\s+["']node:/, /\bprocess\./, /Date\.now/, /new Date/, /Math\.random/]) {
      expect(source).not.toMatch(banned);
    }
  });
});
