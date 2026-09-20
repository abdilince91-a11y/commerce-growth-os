import { describe, expect, it } from "vitest";
import {
  AgeGroupSchema,
  AvailabilitySchema,
  CurrencyCodeSchema,
  DateInputSchema,
  GenderSchema,
  HttpUrlSchema,
  LifecycleStatusSchema,
  ProductConditionSchema,
  SizeTypeSchema,
  isHttpUrl,
} from "./common";

describe("canonical enums are lowercase", () => {
  it.each([
    ["Availability", AvailabilitySchema],
    ["LifecycleStatus", LifecycleStatusSchema],
    ["ProductCondition", ProductConditionSchema],
    ["Gender", GenderSchema],
    ["AgeGroup", AgeGroupSchema],
    ["SizeType", SizeTypeSchema],
  ])("%s has only lowercase members", (_name, schema) => {
    for (const option of schema.options) {
      expect(option).toBe(option.toLowerCase());
    }
  });

  it("keeps the existing Availability members unchanged", () => {
    expect(AvailabilitySchema.options).toEqual([
      "in_stock",
      "out_of_stock",
      "preorder",
      "backorder",
    ]);
  });

  it("rejects uppercase external spellings", () => {
    expect(AvailabilitySchema.safeParse("IN_STOCK").success).toBe(false);
    expect(ProductConditionSchema.safeParse("NEW").success).toBe(false);
    expect(LifecycleStatusSchema.safeParse("ACTIVE").success).toBe(false);
    expect(GenderSchema.safeParse("MALE").success).toBe(false);
  });

  it("has the documented lifecycle, condition, and apparel members", () => {
    expect(LifecycleStatusSchema.options).toEqual(["draft", "active", "archived"]);
    expect(ProductConditionSchema.options).toEqual(["new", "used", "refurbished"]);
    expect(GenderSchema.options).toEqual(["male", "female", "unisex"]);
    expect(AgeGroupSchema.options).toEqual(["newborn", "infant", "toddler", "child", "adult"]);
  });
});

describe("CurrencyCodeSchema", () => {
  it.each(["EUR", "TRY", "USD", "JPY", "KWD"])("accepts %s", (code) => {
    expect(CurrencyCodeSchema.safeParse(code).success).toBe(true);
  });

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
    ["empty", ""],
  ])("rejects %s", (_name, code) => {
    expect(CurrencyCodeSchema.safeParse(code).success).toBe(false);
  });

  it("does not check membership in the ISO list (shape only)", () => {
    expect(CurrencyCodeSchema.safeParse("ZZZ").success).toBe(true);
  });
});

describe("HttpUrlSchema", () => {
  it.each([
    "https://example.com/a?b=c",
    "http://localhost:3000/x",
    "https://cdn.example.com/images/shirt.jpg",
  ])("accepts %s", (url) => {
    expect(isHttpUrl(url)).toBe(true);
    expect(HttpUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/plain,hi"],
    ["ftp scheme", "ftp://example.com/file"],
    ["file scheme", "file:///etc/passwd"],
    ["embedded credentials", "https://user:pw@example.com/x"],
    ["embedded username only", "https://user@example.com/x"],
    ["relative path", "/relative/path"],
    ["bare host", "example.com"],
    ["empty", ""],
    ["scheme only", "http://"],
  ])("rejects %s", (_name, url) => {
    expect(HttpUrlSchema.safeParse(url).success).toBe(false);
  });

  it("rejects absurdly long URLs", () => {
    expect(HttpUrlSchema.safeParse(`https://example.com/${"a".repeat(2100)}`).success).toBe(false);
  });
});

describe("DateInputSchema", () => {
  it("accepts a Date and an ISO string, returning a Date", () => {
    const fromDate = DateInputSchema.parse(new Date("2026-01-01T00:00:00.000Z"));
    const fromString = DateInputSchema.parse("2026-01-01T00:00:00.000Z");
    expect(fromDate).toBeInstanceOf(Date);
    expect(fromString.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects null instead of turning it into the Unix epoch", () => {
    expect(DateInputSchema.safeParse(null).success).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["number", 0],
    ["empty string", ""],
    ["unparseable string", "not a date"],
    ["invalid Date object", new Date("nope")],
  ])("rejects %s", (_name, value) => {
    expect(DateInputSchema.safeParse(value).success).toBe(false);
  });
});
