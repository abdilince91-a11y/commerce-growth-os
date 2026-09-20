import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SkuSchema } from "@/lib/schema/variant";
import {
  buildProductInputId,
  validateContentLanguage,
  validateFeedLabel,
  validateOfferId,
} from "./identifiers";

const CANARY = "SECRET-CANARY-4409";

function failureOf<T extends { ok: boolean }>(result: T) {
  expect(result.ok).toBe(false);
  return result as Extract<T, { ok: false }>;
}

describe("validateOfferId (Variant.sku)", () => {
  it.each([
    ["ordinary sku", "LS-BLU-M"],
    ["single character", "A"],
    ["50 ASCII characters", "a".repeat(50)],
    ["50 emoji (50 code points, 100 UTF-16 units)", "🧵".repeat(50)],
    ["Turkish letters", "İSTANBUL-ÇANTA-ığüşö"],
    ["CJK", "シャツ-青-M"],
    ["Arabic (RTL)", "قميص-أزرق"],
    ["underscore, dot and plus", "A_B.C+D"],
  ])("accepts %s and returns it unchanged", (_name, sku) => {
    expect(validateOfferId(sku)).toEqual({ ok: true, value: sku });
  });

  it("counts Unicode code points, not UTF-16 units, at the 1 and 50 boundaries", () => {
    expect(validateOfferId("🧵".repeat(50)).ok).toBe(true);
    expect(validateOfferId("🧵".repeat(51)).ok).toBe(false);
    expect(validateOfferId("a".repeat(50)).ok).toBe(true);
    expect(validateOfferId("a".repeat(51)).ok).toBe(false);
    expect(validateOfferId("").ok).toBe(false);
    expect(validateOfferId("a").ok).toBe(true);
  });

  it("does not normalize or rewrite: a decomposed sku is returned as supplied", () => {
    const decomposed = "Café";
    const result = validateOfferId(decomposed);
    expect(result).toEqual({ ok: true, value: decomposed });
    expect((result as { value: string }).value).not.toBe(decomposed.normalize("NFC"));
  });

  it.each([
    ["empty", ""],
    ["51 characters", "a".repeat(51)],
    ["tilde", "A~B"],
    ["slash", "A/B"],
    ["percent", "A%B"],
    ["space", "A B"],
    ["leading space", " AB"],
    ["trailing space", "AB "],
    ["tab", "A\tB"],
    ["newline", "A\nB"],
    ["carriage return", "A\rB"],
    ["no-break space", "A B"],
    ["em space", "A B"],
    ["ideographic space", "A　B"],
    ["NUL", "A\u0000B"],
    ["bell control character", "A\u0007B"],
    ["DEL", "A\u007FB"],
    ["C1 control (NEL)", "A\u0085B"],
    ["lone high surrogate", "A\uD800B"],
    ["lone low surrogate", "A\uDC00B"],
    ["null", null],
    ["number", 12345],
    ["object", { sku: "A" }],
  ])("rejects %s", (_name, sku) => {
    expect(failureOf(validateOfferId(sku)).code).toBe("invalid_offer_id");
  });

  it("agrees with the canonical SkuSchema on a shared corpus", () => {
    const corpus = [
      "", "A", "LS-BLU-M", "a".repeat(50), "a".repeat(51), "🧵".repeat(50), "🧵".repeat(51),
      "A~B", "A/B", "A%B", "A B", " A", "A ", "A\tB", "A\nB", "A B", "A　B",
      "A\u0007B", "A\u007FB", "A\u0085B", "İSTANBUL", "シャツ", "قميص", "A_B.C+D", "Café",
    ];
    for (const sku of corpus) {
      expect(validateOfferId(sku).ok, JSON.stringify(sku)).toBe(SkuSchema.safeParse(sku).success);
    }
  });
});

describe("validateContentLanguage", () => {
  it.each(["tr", "en", "de", "fr"])("accepts %s", (value) => {
    expect(validateContentLanguage(value)).toEqual({ ok: true, value });
  });

  it.each([
    ["uppercase", "TR"],
    ["mixed case", "Tr"],
    ["one letter", "t"],
    ["three letters", "tur"],
    ["region subtag", "en-US"],
    ["digit", "t1"],
    ["leading space", " tr"],
    ["trailing space", "tr "],
    ["trailing newline", "tr\n"],
    ["non-ASCII letter", "tü"],
    ["full-width letters", "ｔｒ"],
    ["empty", ""],
    ["null", null],
    ["number", 90],
  ])("rejects %s", (_name, value) => {
    expect(failureOf(validateContentLanguage(value)).code).toBe("invalid_content_language");
  });
});

describe("validateFeedLabel", () => {
  it.each(["TR", "US", "EU-1", "DE_MAIN", "A", "X1", "TR-2026_A"])("accepts %s", (value) => {
    expect(validateFeedLabel(value)).toEqual({ ok: true, value });
  });

  it.each([
    ["lowercase", "tr"],
    ["mixed case", "Tr"],
    ["tilde", "TR~1"],
    ["space", "TR 1"],
    ["dot", "TR.1"],
    ["slash", "TR/1"],
    ["percent", "TR%1"],
    ["leading space", " TR"],
    ["trailing newline", "TR\n"],
    ["non-ASCII uppercase letter", "TÜRKİYE"],
    ["full-width letters", "ＴＲ"],
    ["empty", ""],
    ["null", null],
    ["number", 1],
  ])("rejects %s", (_name, value) => {
    expect(failureOf(validateFeedLabel(value)).code).toBe("invalid_feed_label");
  });
});

describe("buildProductInputId", () => {
  it("builds contentLanguage~feedLabel~offerId", () => {
    expect(
      buildProductInputId({ contentLanguage: "tr", feedLabel: "TR", offerId: "LS-BLU-M" }),
    ).toEqual({ ok: true, value: "tr~TR~LS-BLU-M" });
  });

  it("is deterministic and depends only on its three inputs", () => {
    const input = { contentLanguage: "en", feedLabel: "US", offerId: "SKU-1" };
    const first = buildProductInputId(input);
    for (let i = 0; i < 3; i++) expect(buildProductInputId({ ...input })).toEqual(first);
    expect(buildProductInputId({ ...input, offerId: "SKU-2" })).not.toEqual(first);
    expect(buildProductInputId({ ...input, feedLabel: "TR" })).not.toEqual(first);
    expect(buildProductInputId({ ...input, contentLanguage: "tr" })).not.toEqual(first);
  });

  it("keeps a Unicode sku exactly as supplied", () => {
    expect(
      buildProductInputId({ contentLanguage: "tr", feedLabel: "TR", offerId: "İSTANBUL-ÇANTA" }),
    ).toEqual({ ok: true, value: "tr~TR~İSTANBUL-ÇANTA" });
  });

  it("always yields exactly three tilde-separated parts for valid input", () => {
    const result = buildProductInputId({ contentLanguage: "tr", feedLabel: "TR-1_A", offerId: "A_B.C+D" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.split("~")).toEqual(["tr", "TR-1_A", "A_B.C+D"]);
  });

  it("never escapes or rewrites an invalid component: it fails instead", () => {
    const withTilde = buildProductInputId({ contentLanguage: "tr", feedLabel: "TR", offerId: "A~B" });
    const failure = failureOf(withTilde);
    expect("value" in failure).toBe(false);
    expect(failure.issues).toEqual([
      { field: "offerId", code: "invalid_offer_id", message: expect.any(String) },
    ]);
  });

  it("does not trim or normalize components", () => {
    expect(buildProductInputId({ contentLanguage: " tr", feedLabel: "TR", offerId: "A" }).ok).toBe(false);
    expect(buildProductInputId({ contentLanguage: "tr", feedLabel: "TR ", offerId: "A" }).ok).toBe(false);
    expect(buildProductInputId({ contentLanguage: "tr", feedLabel: "TR", offerId: " A" }).ok).toBe(false);
  });

  it("reports every invalid component in a fixed order", () => {
    const failure = failureOf(
      buildProductInputId({ contentLanguage: "TR", feedLabel: "t~r", offerId: "" }),
    );
    expect(failure.issues.map((issue) => issue.field)).toEqual([
      "contentLanguage",
      "feedLabel",
      "offerId",
    ]);
    expect(failure.issues.map((issue) => issue.code)).toEqual([
      "invalid_content_language",
      "invalid_feed_label",
      "invalid_offer_id",
    ]);
  });

  it("reports only the components that are invalid", () => {
    const failure = failureOf(
      buildProductInputId({ contentLanguage: "tr", feedLabel: "TR", offerId: "A B" }),
    );
    expect(failure.issues.map((issue) => issue.field)).toEqual(["offerId"]);
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
      expect(() => validateOfferId(input)).not.toThrow();
      expect(() => validateContentLanguage(input)).not.toThrow();
      expect(() => validateFeedLabel(input)).not.toThrow();
      expect(() =>
        buildProductInputId({ contentLanguage: input, feedLabel: input, offerId: input }),
      ).not.toThrow();
    }
  });

  it("never echoes a raw value in an error message", () => {
    const failures = [
      failureOf(validateOfferId(`${CANARY} ~`)),
      failureOf(validateContentLanguage(`${CANARY}`)),
      failureOf(validateFeedLabel(`${CANARY.toLowerCase()}`)),
    ];
    for (const failure of failures) {
      expect(failure.message).not.toContain(CANARY);
      expect(failure.message).not.toContain(CANARY.toLowerCase());
    }
    const composite = failureOf(
      buildProductInputId({ contentLanguage: CANARY, feedLabel: CANARY, offerId: `${CANARY} ~` }),
    );
    for (const issue of composite.issues) {
      expect(issue.message).not.toContain(CANARY);
      expect(issue.message).not.toContain(CANARY.toLowerCase());
    }
  });

  it("has no I/O, network, clock, randomness, or locale dependence in its source", () => {
    const source = readFileSync(new URL("./identifiers.ts", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const banned of [
      /\bfetch\s*\(/, /\brequire\s*\(/, /import\s*\(/, /from\s+["']node:/, /\bprocess\./,
      /Date\.now/, /new Date/, /Math\.random/, /toLocale/, /Intl\./,
    ]) {
      expect(source).not.toMatch(banned);
    }
  });
});
