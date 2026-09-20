import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX_CODE_POINTS,
  TITLE_MAX_CODE_POINTS,
  countCodePoints,
  hasLoneSurrogate,
  normalizeBoundedText,
  normalizeText,
} from "./text";

const CANARY = "SECRET-CANARY-2288";

const FAMILY = "👨‍👩‍👧"; // man + ZWJ + woman + ZWJ + girl: 5 code points, 8 UTF-16 units
const COMPOSED_E_ACUTE = "é"; // é
const DECOMPOSED_E_ACUTE = "é";

function failureOf<T extends { ok: boolean }>(result: T) {
  expect(result.ok).toBe(false);
  return result as Extract<T, { ok: false }>;
}

describe("countCodePoints", () => {
  it.each([
    ["empty", "", 0],
    ["ASCII", "abc", 3],
    ["composed é", COMPOSED_E_ACUTE, 1],
    ["decomposed é", DECOMPOSED_E_ACUTE, 2],
    ["single emoji (2 UTF-16 units)", "😀", 1],
    ["ZWJ family emoji", FAMILY, 5],
    ["regional-indicator flag", "🇹🇷", 2],
    ["CJK", "日本語", 3],
    ["Turkish", "İıçğöşü", 7],
    ["Arabic", "قميص", 4],
  ])("counts %s as %s code points", (_name, text, expected) => {
    expect(countCodePoints(text)).toBe(expected);
  });

  it("counts code points, not UTF-16 code units", () => {
    expect(FAMILY.length).toBe(8);
    expect(countCodePoints(FAMILY)).toBe(5);
    expect("😀".length).toBe(2);
    expect(countCodePoints("😀")).toBe(1);
  });
});

describe("hasLoneSurrogate", () => {
  it("detects unpaired surrogates only", () => {
    expect(hasLoneSurrogate("\uD800")).toBe(true);
    expect(hasLoneSurrogate("\uDC00")).toBe(true);
    expect(hasLoneSurrogate("a\uD800b")).toBe(true);
    expect(hasLoneSurrogate("\uDC00\uD800")).toBe(true);
    expect(hasLoneSurrogate("😀")).toBe(false);
    expect(hasLoneSurrogate(FAMILY)).toBe(false);
    expect(hasLoneSurrogate("plain")).toBe(false);
  });
});

describe("normalizeText (NFC and trim only)", () => {
  it("composes canonical sequences (NFC)", () => {
    expect(normalizeText(DECOMPOSED_E_ACUTE)).toEqual({ ok: true, value: COMPOSED_E_ACUTE });
    expect(normalizeText("ç")).toEqual({ ok: true, value: "ç" }); // ç
    expect(normalizeText("İ")).toEqual({ ok: true, value: "İ" }); // İ
  });

  it("treats NFC and NFD forms of the same text as equal after normalization", () => {
    const nfc = "Çanta Şık Ürün Ğ".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(normalizeText(nfd)).toEqual(normalizeText(nfc));
    expect(normalizeText(nfc)).toEqual({ ok: true, value: nfc });
  });

  it("is idempotent", () => {
    const once = normalizeText(`  ${DECOMPOSED_E_ACUTE}  `);
    expect(once.ok).toBe(true);
    if (once.ok) expect(normalizeText(once.value)).toEqual(once);
  });

  it("trims leading and trailing whitespace of every kind", () => {
    expect(normalizeText("  x  ")).toEqual({ ok: true, value: "x" });
    expect(normalizeText("\t\n x \r\n")).toEqual({ ok: true, value: "x" });
    expect(normalizeText(" x ")).toEqual({ ok: true, value: "x" });
    expect(normalizeText("　x　")).toEqual({ ok: true, value: "x" });
    expect(normalizeText("﻿x")).toEqual({ ok: true, value: "x" });
  });

  it("leaves interior whitespace and newlines untouched", () => {
    expect(normalizeText("a  b")).toEqual({ ok: true, value: "a  b" });
    expect(normalizeText("a\nb")).toEqual({ ok: true, value: "a\nb" });
    expect(normalizeText("a b")).toEqual({ ok: true, value: "a b" });
  });

  it("never changes case, including Turkish dotted and dotless i", () => {
    for (const text of ["İstanbul Çanta", "ISPARTA", "ısparta", "iI", "ıİ", "TITLE case", "lower"]) {
      expect(normalizeText(text)).toEqual({ ok: true, value: text });
    }
  });

  it("applies canonical (NFC) composition only, never compatibility (NFKC) mapping", () => {
    for (const text of ["ｼｬﾂ", "①", "ﬁ", "㎏", "Ⅷ", "ｆｕｌｌ"]) {
      expect(normalizeText(text)).toEqual({ ok: true, value: text });
    }
  });

  it("preserves CJK, right-to-left text, and directional marks unchanged", () => {
    for (const text of ["日本語のシャツ", "シャツ 青", "قميص أزرق", "חולצה כחולה", "abc‮def", "a‏b"]) {
      expect(normalizeText(text)).toEqual({ ok: true, value: text });
    }
  });

  it("preserves emoji and ZWJ sequences unchanged", () => {
    for (const text of [FAMILY, "😀", "🇹🇷", "👍🏽", "❤️"]) {
      expect(normalizeText(text)).toEqual({ ok: true, value: text });
    }
  });

  it("returns an empty string for whitespace-only input (emptiness is the caller's rule)", () => {
    expect(normalizeText("   ")).toEqual({ ok: true, value: "" });
    expect(normalizeText("")).toEqual({ ok: true, value: "" });
  });

  it("rejects lone surrogates as malformed Unicode", () => {
    for (const bad of ["\uD800", "\uDC00", "a\uD800b", "\uDC00\uD800"]) {
      expect(failureOf(normalizeText(bad)).code).toBe("malformed_unicode");
    }
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["object", { text: "x" }],
    ["array", ["x"]],
    ["boolean", false],
  ])("rejects a non-string: %s", (_name, value) => {
    expect(failureOf(normalizeText(value)).code).toBe("invalid_text");
  });
});

describe("normalizeBoundedText (never truncates)", () => {
  it("exposes the documented Merchant limits", () => {
    expect(TITLE_MAX_CODE_POINTS).toBe(150);
    expect(DESCRIPTION_MAX_CODE_POINTS).toBe(5000);
  });

  it("returns the normalized text and its code-point count", () => {
    expect(normalizeBoundedText("  Çanta  ", 150)).toEqual({ ok: true, value: "Çanta", codePoints: 5 });
  });

  it.each([
    ["ASCII", "a"],
    ["Turkish", "ç"],
    ["Turkish dotted capital", "İ"],
    ["CJK", "日"],
    ["Arabic", "ع"],
    ["emoji", "😀"],
    ["ZWJ family (5 code points each)", FAMILY],
  ])("accepts exactly the limit and rejects one more: %s", (_name, unit) => {
    const perUnit = countCodePoints(unit);
    const atLimit = unit.repeat(Math.floor(TITLE_MAX_CODE_POINTS / perUnit));
    const remainder = TITLE_MAX_CODE_POINTS - countCodePoints(atLimit);
    const exact = atLimit + "a".repeat(remainder);
    expect(countCodePoints(exact)).toBe(TITLE_MAX_CODE_POINTS);
    expect(normalizeBoundedText(exact, TITLE_MAX_CODE_POINTS)).toEqual({
      ok: true,
      value: exact,
      codePoints: TITLE_MAX_CODE_POINTS,
    });
    expect(failureOf(normalizeBoundedText(`${exact}a`, TITLE_MAX_CODE_POINTS)).code).toBe("text_too_long");
  });

  it("counts after NFC composition: 150 decomposed letters are 150 code points, not 300", () => {
    const decomposed = DECOMPOSED_E_ACUTE.repeat(150);
    expect(countCodePoints(decomposed)).toBe(300);
    expect(normalizeBoundedText(decomposed, 150)).toEqual({
      ok: true,
      value: COMPOSED_E_ACUTE.repeat(150),
      codePoints: 150,
    });
    expect(failureOf(normalizeBoundedText(DECOMPOSED_E_ACUTE.repeat(151), 150)).code).toBe("text_too_long");
  });

  it("does not count surrounding whitespace toward the limit", () => {
    const exact = "a".repeat(150);
    expect(normalizeBoundedText(`   ${exact}   `, 150).ok).toBe(true);
    expect(normalizeBoundedText(`   ${exact}a   `, 150).ok).toBe(false);
  });

  it("counts UTF-16 units correctly for emoji at the description limit", () => {
    const exact = "😀".repeat(DESCRIPTION_MAX_CODE_POINTS);
    expect(exact.length).toBe(10000);
    expect(normalizeBoundedText(exact, DESCRIPTION_MAX_CODE_POINTS).ok).toBe(true);
    expect(failureOf(normalizeBoundedText(`${exact}😀`, DESCRIPTION_MAX_CODE_POINTS)).code).toBe("text_too_long");
  });

  it("never returns a truncated value on failure", () => {
    const failure = failureOf(normalizeBoundedText("x".repeat(151), 150));
    expect("value" in failure).toBe(false);
    expect("codePoints" in failure).toBe(false);
  });

  it("rejects empty and whitespace-only text as text_empty", () => {
    for (const text of ["", "   ", "\n\t", " 　"]) {
      expect(failureOf(normalizeBoundedText(text, 150)).code).toBe("text_empty");
    }
  });

  it("forwards non-string and malformed-Unicode failures", () => {
    expect(failureOf(normalizeBoundedText(42, 150)).code).toBe("invalid_text");
    expect(failureOf(normalizeBoundedText("\uD800", 150)).code).toBe("malformed_unicode");
  });

  it("throws RangeError for a programmer-supplied invalid limit", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => normalizeBoundedText("x", bad)).toThrow(RangeError);
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

  it("never throws on hostile external input", () => {
    for (const input of hostile) {
      expect(() => normalizeText(input)).not.toThrow();
      expect(() => normalizeBoundedText(input, 150)).not.toThrow();
    }
  });

  it("never echoes the raw value in an error message", () => {
    const failures = [
      failureOf(normalizeText(Symbol(CANARY))),
      failureOf(normalizeText({ CANARY })),
      failureOf(normalizeText(`${CANARY}\uD800`)),
      failureOf(normalizeBoundedText(`${CANARY}${"x".repeat(200)}`, 150)),
      failureOf(normalizeBoundedText("   ", 150)),
    ];
    for (const failure of failures) {
      expect(failure.message).not.toContain(CANARY);
      expect(failure.message.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic", () => {
    const input = `  ${DECOMPOSED_E_ACUTE} İstanbul  `;
    const first = normalizeText(input);
    for (let i = 0; i < 3; i++) expect(normalizeText(input)).toEqual(first);
  });

  it("changes no case and truncates nothing in its source", () => {
    const source = readFileSync(new URL("./text.ts", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const banned of [/toLowerCase/, /toUpperCase/, /toLocale/, /\.slice\(/, /\.substring\(/, /\.substr\(/, /\.padEnd\(/, /\.replace\(/, /\.normalize\("NFK/]) {
      expect(source).not.toMatch(banned);
    }
  });

  it("has no I/O, network, clock, or randomness in its source", () => {
    const source = readFileSync(new URL("./text.ts", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const banned of [/\bfetch\s*\(/, /\brequire\s*\(/, /import\s*\(/, /from\s+["']node:/, /\bprocess\./, /Date\.now/, /new Date/, /Math\.random/, /Intl\./]) {
      expect(source).not.toMatch(banned);
    }
  });
});
