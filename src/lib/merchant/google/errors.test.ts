import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ISSUE_MESSAGES,
  MAPPER_ISSUE_CODES,
  WARNING_ISSUE_CODES,
  createIssue,
  errorsOf,
  hasErrors,
  issueFromFailure,
  safeOfferId,
  summarizeIssues,
  warningsOf,
  type MerchantIssue,
} from "./errors";
import { validateGtin } from "./gtin";
import { validateHttpUrl } from "./urls";

const CANARY = "SECRET-CANARY-5150";

describe("issue codes and messages", () => {
  it("has a non-empty static message for every mapper issue code", () => {
    for (const code of MAPPER_ISSUE_CODES) {
      const message = ISSUE_MESSAGES[code];
      expect(typeof message, code).toBe("string");
      expect(message.length, code).toBeGreaterThan(0);
    }
    expect(Object.keys(ISSUE_MESSAGES).sort()).toEqual([...MAPPER_ISSUE_CODES].sort());
  });

  it("lists every code once", () => {
    expect(new Set(MAPPER_ISSUE_CODES).size).toBe(MAPPER_ISSUE_CODES.length);
  });

  it("covers the codes the plan calls for", () => {
    for (const code of [
      "missing_required_field",
      "missing_identifier",
      "mpn_requires_brand",
      "title_too_long",
      "description_too_long",
      "too_many_images",
      "missing_availability_date",
      "duplicate_offer_id",
      "variant_not_distinguishable",
      "mixed_currencies",
      "variant_product_mismatch",
      "gtin_without_brand",
    ]) {
      expect(MAPPER_ISSUE_CODES as readonly string[], code).toContain(code);
    }
  });

  it("uses messages that are free of interpolation markers and raw-value placeholders", () => {
    for (const code of MAPPER_ISSUE_CODES) {
      const message = ISSUE_MESSAGES[code];
      expect(message, code).not.toMatch(/\$\{|\{\{|%s|%d|<value>|\bundefined\b|\bnull\b/);
    }
  });

  it("marks exactly the documented codes as warnings", () => {
    expect([...WARNING_ISSUE_CODES].sort()).toEqual(
      ["availability_date_ignored", "gtin_without_brand", "unmapped_attribute"].sort(),
    );
    for (const code of WARNING_ISSUE_CODES) expect(MAPPER_ISSUE_CODES as readonly string[]).toContain(code);
  });
});

describe("createIssue", () => {
  it("builds an error issue with the static message", () => {
    expect(createIssue("missing_identifier", "variant.gtin")).toEqual({
      code: "missing_identifier",
      severity: "error",
      path: "variant.gtin",
      message: ISSUE_MESSAGES.missing_identifier,
    });
  });

  it("builds a warning for warning codes", () => {
    expect(createIssue("gtin_without_brand", "variant.gtin").severity).toBe("warning");
    expect(createIssue("availability_date_ignored", "variant.availabilityDate").severity).toBe("warning");
    expect(createIssue("mpn_requires_brand", "variant.mpn").severity).toBe("error");
  });

  it("does not add an offerId key unless one is supplied and valid", () => {
    expect("offerId" in createIssue("missing_identifier", "variant.gtin")).toBe(false);
    expect(createIssue("missing_identifier", "variant.gtin", "LS-BLU-M").offerId).toBe("LS-BLU-M");
    expect("offerId" in createIssue("missing_identifier", "variant.gtin", `bad ${CANARY} sku`)).toBe(false);
  });

  it.each([
    "product.title",
    "variant.gtin",
    "product.images[2]",
    "channel.feedLabel",
    "link",
    "input",
  ])("accepts the safe path %s", (path) => {
    expect(createIssue("invalid_enum_value", path).path).toBe(path);
  });

  it.each([
    ["contains a space", "variant sku"],
    ["contains a colon", `variant.sku: ${CANARY}`],
    ["contains a slash", "https://example.com/x"],
    ["contains a quote", 'variant."sku"'],
    ["starts with a digit", "2variant"],
    ["is empty", ""],
    ["is very long", `product.${"a".repeat(200)}`],
    ["contains a newline", "variant\nsku"],
  ])("rejects a path that %s (a raw value must never be able to enter a path)", (_name, path) => {
    expect(() => createIssue("invalid_enum_value", path)).toThrow(RangeError);
  });
});

describe("issueFromFailure (Slice 1 failures)", () => {
  it("keeps the failure's code and static message and marks it an error", () => {
    const failure = validateGtin("0012345678906");
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(issueFromFailure(failure, "variant.gtin")).toEqual({
        code: "gtin_bad_check_digit",
        severity: "error",
        path: "variant.gtin",
        message: failure.message,
      });
    }
  });

  it("carries a sanitized offerId when one is supplied", () => {
    const failure = validateHttpUrl("https://user:pw@example.com/");
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(issueFromFailure(failure, "link", "LS-BLU-M").offerId).toBe("LS-BLU-M");
      expect("offerId" in issueFromFailure(failure, "link", `x ${CANARY}`)).toBe(false);
    }
  });

  it("never lets the failure message contain the rejected value", () => {
    const failure = validateHttpUrl(`https://user:${CANARY}@host-${CANARY}.example.com/?t=${CANARY}`);
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(issueFromFailure(failure, "link").message).not.toContain(CANARY);
  });

  it("rejects an unsafe path the same way createIssue does", () => {
    const failure = validateGtin("x");
    if (!failure.ok) expect(() => issueFromFailure(failure, `variant ${CANARY}`)).toThrow(RangeError);
  });
});

describe("safeOfferId", () => {
  it("returns a valid SKU unchanged", () => {
    for (const sku of ["LS-BLU-M", "A", "a".repeat(50), "İSTANBUL-ÇANTA", "🧵".repeat(50)]) {
      expect(safeOfferId(sku)).toBe(sku);
    }
  });

  it("returns undefined for anything that is not a valid SKU, so an invalid raw value is never echoed", () => {
    for (const value of [
      "", "a".repeat(51), "has space", "has\tcontrol\u0007", "tilde~here", `${CANARY}/x`, `100%${CANARY}`,
      null, undefined, 42, {}, ["LS-BLU-M"],
    ]) {
      expect(safeOfferId(value)).toBeUndefined();
    }
  });
});

describe("issue helpers", () => {
  const issues: MerchantIssue[] = [
    createIssue("gtin_without_brand", "variant.gtin", "A"),
    createIssue("missing_identifier", "variant.gtin", "A"),
    createIssue("availability_date_ignored", "variant.availabilityDate"),
  ];

  it("separates errors from warnings", () => {
    expect(hasErrors(issues)).toBe(true);
    expect(hasErrors([issues[0] as MerchantIssue, issues[2] as MerchantIssue])).toBe(false);
    expect(hasErrors([])).toBe(false);
    expect(errorsOf(issues).map((i) => i.code)).toEqual(["missing_identifier"]);
    expect(warningsOf(issues).map((i) => i.code)).toEqual(["gtin_without_brand", "availability_date_ignored"]);
  });

  it("summarizes for logging without any message text", () => {
    const summary = summarizeIssues(issues);
    expect(summary).toEqual({
      errors: 1,
      warnings: 2,
      entries: [
        { code: "gtin_without_brand", severity: "warning", path: "variant.gtin", offerId: "A" },
        { code: "missing_identifier", severity: "error", path: "variant.gtin", offerId: "A" },
        { code: "availability_date_ignored", severity: "warning", path: "variant.availabilityDate" },
      ],
    });
    expect(JSON.stringify(summary)).not.toContain(ISSUE_MESSAGES.missing_identifier);
    for (const entry of summary.entries) expect("message" in entry).toBe(false);
  });

  it("is deterministic and does not mutate its input", () => {
    const frozen = Object.freeze([...issues]);
    expect(summarizeIssues(frozen)).toEqual(summarizeIssues(frozen));
    expect(frozen).toEqual(issues);
  });
});

describe("safety properties", () => {
  it("has no I/O, network, clock, randomness, or locale dependence in its source", () => {
    const source = readFileSync(new URL("./errors.ts", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const banned of [
      /\bfetch\s*\(/, /\brequire\s*\(/, /import\s*\(/, /from\s+["']node:/, /\bprocess\./,
      /Date\.now/, /new Date/, /Math\.random/, /toLocale/, /Intl\./, /localeCompare/,
      /prisma/i, /@\/lib\/db/, /@\/lib\/proposals/, /applyProposal/, /createProposal/,
    ]) {
      expect(source).not.toMatch(banned);
    }
  });
});
