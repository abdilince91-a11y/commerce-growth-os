import { describe, expect, it } from "vitest";
import { offer } from "./__fixtures__/records";
import { createPinterestCatalogAdapter, mapOffer, mapOffers, createCatalogPreview, toFeedUpdateProposal } from "./index";

function mapped(input: unknown = offer()) {
  const result = mapOffer(input);
  expect(result.status).toBe("mapped");
  if (result.status !== "mapped") throw new Error("Expected mapped fixture");
  return result;
}
function invalid(input: unknown) {
  const result = mapOffer(input);
  expect(result.status).toBe("invalid");
  if (result.status !== "invalid") throw new Error("Expected invalid fixture");
  return result;
}

describe("Pinterest retail catalog adapter", () => {
  it("maps canonical variant identity and feed fields without Google spellings", () => {
    const { item } = mapped();
    expect(item).toEqual({
      id: "SHIRT-BLUE-M", item_group_id: "product-1", title: "Linen Shirt — Blue / M",
      description: "A relaxed linen shirt.", link: "https://shop.example/products/shirt?variant=blue-m",
      image_link: "https://cdn.example/one.jpg", additional_image_link: ["https://cdn.example/two.jpg"],
      price: "29.90 EUR", availability: "in stock", condition: "new", brand: "ONOE",
      GTIN: "012345678905", color: "Blue", size: "M", material: "linen", pattern: "solid",
      gender: "unisex", age_group: "adult", product_type: "Clothing > Shirts",
    });
    expect(item).not.toHaveProperty("size_type");
    expect(item).not.toHaveProperty("size_system");
  });
  it.each([[1, "0.01"], [10, "0.10"], [100, "1.00"], [1999, "19.99"], [2147483647, "21474836.47"]])(
    "formats exact integer minor units %i", (amount, expected) => {
      expect(mapped(offer({}, { priceAmount: amount as number })).item.price).toBe(`${expected} EUR`);
    },
  );
  it("uses compare-at as regular price and current price as sale price", () => {
    expect(mapped(offer({}, { priceAmount: 100, compareAtPriceAmount: 199, currency: "TRY" })).item)
      .toMatchObject({ price: "1.99 TRY", sale_price: "1.00 TRY" });
  });
  it.each([0, -1, 0.1, NaN, Infinity, 2147483648])("rejects invalid amounts %s", (priceAmount) => {
    invalid(offer({}, { priceAmount }));
  });
  it.each([0, 2990, 2000])("rejects invalid compare-at price %i", (compareAtPriceAmount) => {
    invalid(offer({}, { compareAtPriceAmount }));
  });
  it.each(["USD", "GBP", "eur", "EU", "SECRET"])("does not guess currency %s", (currency) => {
    invalid(offer({}, { currency }));
  });
  it.each([["in_stock", "in stock"], ["out_of_stock", "out of stock"], ["preorder", "preorder"]] as const)(
    "maps availability %s", (availability, expected) => {
      expect(mapped(offer({}, { availability })).item.availability).toBe(expected);
    },
  );
  it("refuses unsupported backorder and known-zero in-stock inventory", () => {
    invalid(offer({}, { availability: "backorder" }));
    invalid(offer({}, { inventoryQuantity: 0 }));
    mapped(offer({}, { inventoryQuantity: undefined }));
  });
  it.each(["draft", "archived"] as const)("skips %s records before validating incomplete commerce data", (status) => {
    expect(mapOffer({ product: { status } })).toMatchObject({ status: "skipped", reason: `product_${status}` });
    expect(mapOffer({ product: { status: "active" }, variant: { status } })).toMatchObject({ status: "skipped", reason: `variant_${status}` });
  });
  it.each([null, undefined, 4, [], {}, { product: null }, { product: {}, variant: {} }].map((input) => ({ input })))("rejects malformed JSON records (%j)", ({ input }) => {
    invalid(input);
  });
  it("rejects a variant belonging to a different family", () => {
    expect(invalid(offer({}, { productId: "other" })).issues).toContainEqual(expect.objectContaining({ code: "product_variant_mismatch" }));
  });
  it.each(["", " ", "=IMPORTXML(1)", "+CMD", "-1", "@SUM(1)", "a\u0000b", "a\ud800"])("rejects unsafe identifiers (%j)", (sku) => {
    invalid(offer({}, { sku }));
  });
  it("keeps identifier spelling and percent-encoded URL content unchanged", () => {
    const input = offer({ id: "PRODUCT-É", }, { productId: "PRODUCT-É", sku: "Café-M" }, "HTTPS://SHOP.EXAMPLE/p?variant=1&x=%2F");
    expect(mapped(input).item).toMatchObject({ id: "Café-M", item_group_id: "PRODUCT-É", link: input.link });
  });
  it.each(["javascript:alert(1)", "https://user:pass@example.com/x", "https://@example.com/x", "https://example.com/a b", "https://example.com/a\\b", "http:example.com", "https://example.com/\nsecret"])(
    "rejects unsafe URL (%j)", (link) => { invalid(offer({}, {}, link)); },
  );
  it("applies independent landing and image URL limits and rejects image commas", () => {
    const link = "https://shop.example/";
    mapped(offer({}, {}, link + "x".repeat(511 - link.length)));
    invalid(offer({}, {}, link + "x".repeat(512 - link.length)));
    const image = "https://cdn.example/";
    mapped(offer({}, { imageUrl: image + "x".repeat(2000 - image.length) }));
    invalid(offer({}, { imageUrl: image + "x".repeat(2001 - image.length) }));
    invalid(offer({}, { imageUrl: image + "one,two.jpg" }));
    mapped(offer({}, { imageUrl: image + "one%2Ctwo.jpg" }));
  });
  it("prefers the variant image and deduplicates other images", () => {
    const input = offer({ images: ["https://cdn.example/one.jpg", "https://cdn.example/one.jpg"] }, { imageUrl: "https://cdn.example/variant.jpg" });
    expect(mapped(input).item).toMatchObject({ image_link: "https://cdn.example/variant.jpg", additional_image_link: ["https://cdn.example/one.jpg"] });
  });
  it("refuses more than ten additional images instead of dropping them", () => {
    const images = Array.from({ length: 11 }, (_, i) => `https://cdn.example/${i}.jpg`);
    mapped(offer({ images }));
    invalid(offer({ images: [...images, "https://cdn.example/last.jpg"] }));
  });
  it("normalizes text with NFC and outer trim, without shortening descriptions", () => {
    const result = mapped(offer({ title: "  Cafe\u0301  ", description: "  Text\nline  " }, { color: undefined, size: undefined }));
    expect(result.item.title).toBe("Café");
    expect(result.item.description).toBe("Text\nline");
  });
  it.each(["title", "description", "brand", "material", "pattern", "productType"] as const)("rejects formula-leading product %s", (field) => {
    invalid(offer({ [field]: "  =SECRET()" }));
  });
  it.each(["<p>text</p>", "<!-- secret -->", "<script>alert(1)</script>"])("rejects HTML rather than stripping it (%s)", (description) => {
    invalid(offer({ description }));
  });
  it.each([["title", 500], ["description", 10000], ["brand", 100], ["material", 30], ["pattern", 30]] as const)(
    "enforces %s code-point limit %i", (field, limit) => {
      mapped(offer({ [field]: "é".repeat(limit) }, { color: undefined, size: undefined }));
      invalid(offer({ [field]: "é".repeat(limit + 1) }, { color: undefined, size: undefined }));
    },
  );
  it("counts emoji as one code point and catches variant suffix overflow", () => {
    mapped(offer({ title: "🧥".repeat(500) }, { color: undefined, size: undefined }));
    invalid(offer({ title: "x".repeat(500) }));
  });
  it.each(["color", "size"] as const)("enforces the stricter Pinterest %s limit", (field) => {
    mapped(offer({}, { [field]: "x".repeat(30) }));
    invalid(offer({}, { [field]: "x".repeat(31) }));
  });
  it("maps child to kids, preserves GTIN and validates MPN independently", () => {
    expect(mapped(offer({ ageGroup: "child" })).item).toMatchObject({ age_group: "kids", GTIN: "012345678905" });
    mapped(offer({}, { gtin: undefined, mpn: "ABC123" }));
    invalid(offer({}, { mpn: "A-B" }));
    invalid(offer({}, { mpn: "A".repeat(71) }));
    invalid(offer({}, { gtin: "012345678906" }));
    invalid(offer({}, { gtin: "0000000000000" }));
  });
  it("rejects malformed product taxonomy and excessive depth", () => {
    invalid(offer({ productType: "a>b" }));
    invalid(offer({ productType: "a > b > c > d > e > f" }));
  });
  it("does not expose arbitrary keys or canary values in validation diagnostics", () => {
    const result = invalid(offer({ attributes: { SECRET_CANARY: 123 } } as never, { sku: "SECRET_CANARY/" }));
    expect(JSON.stringify(result)).not.toContain("SECRET_CANARY");
  });
  it("never mutates its input", () => {
    const input = offer(); const before = structuredClone(input);
    mapped(input); expect(input).toEqual(before);
  });
  it("returns a frozen facade with only pure preview operations", () => {
    const adapter = createPinterestCatalogAdapter();
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(Object.keys(adapter).sort()).toEqual(["createCatalogPreview", "mapOffer", "mapOffers", "toFeedUpdateProposal"]);
  });
});

describe("Pinterest batch and CSV preview", () => {
  const second = () => offer({}, { id: "variant-2", sku: "SHIRT-RED-L", gtin: "96385074", color: "Red", size: "L" });
  it("sorts mapped rows by ordinal ID independently of input order", () => {
    const a = createCatalogPreview([second(), offer()]); const b = createCatalogPreview([offer(), second()]);
    expect(a).toEqual(b); expect(a.status).toBe("ready");
  });
  it.each(["sku", "gtin"] as const)("rejects all duplicate %s entries", (field) => {
    const other = second(); other.variant[field] = offer().variant[field]!;
    const result = mapOffers([offer(), other]);
    expect(result.mapped).toHaveLength(0); expect(result.invalid).toHaveLength(2);
  });
  it("rejects every member of mixed-currency and duplicate-attribute families", () => {
    const other = second(); other.variant.currency = "TRY";
    expect(mapOffers([offer(), other]).invalid).toHaveLength(2);
    const same = second(); same.variant.color = " blue "; same.variant.size = "m";
    expect(mapOffers([offer(), same]).invalid).toHaveLength(2);
  });
  it("does not turn invalid active offers into a partial CSV", () => {
    const result = createCatalogPreview([offer(), offer({}, { priceAmount: 0 })]);
    expect(result.status).toBe("invalid"); expect(result).not.toHaveProperty("csv");
  });
  it.each([{ inputs: [] }, { inputs: [offer({ status: "draft" })] }])("refuses an empty or entirely skipped feed", ({ inputs }) => {
    expect(createCatalogPreview(inputs).status).toBe("invalid");
  });
  it("limits batch size and rejects non-array input", () => {
    expect(createCatalogPreview(Array(1001).fill(offer())).invalid[0]?.issues[0]?.code).toBe("batch_limit");
    expect(createCatalogPreview(null).invalid[0]?.issues[0]?.code).toBe("batch_limit");
  });
  it("quotes every cell, escapes quotes, preserves multiline text and uses CRLF records", () => {
    const result = createCatalogPreview([offer({ title: 'Linen, "Shirt"', description: 'Line one\nLine "two"' })]);
    if (result.status !== "ready") throw new Error("Expected CSV");
    expect(result.csv).toContain('"Linen, ""Shirt"" — Blue / M"');
    expect(result.csv).toContain('"Line one\nLine ""two"""');
    expect(result.csv).toMatch(/^"id","title","description"/);
    expect(result.csv.endsWith("\r\n")).toBe(true);
  });
  it("creates detached validated proposals and rejects a different before ID", () => {
    const result = mapped(); const proposal = toFeedUpdateProposal(result);
    expect(proposal).toMatchObject({ type: "feed_update", targetEntity: "pinterest_catalog_item", targetId: result.item.id, before: { state: "absent" }, createdBy: "system" });
    expect(proposal.after).toEqual(result.item);
    expect(proposal.after).not.toBe(result.item);
    expect(() => toFeedUpdateProposal(result, { ...result.item, id: "other" })).toThrow();
    expect(() => toFeedUpdateProposal({ status: "invalid", issues: [] } as never)).toThrow();
    expect(() => toFeedUpdateProposal({ ...result, item: { ...result.item, title: "=SECRET()" } })).toThrow();
  });
});

describe("Pinterest preview safety edges", () => {
  it("never exposes CSV for an oversized UTF-8 catalog", () => {
    const description = "🧥".repeat(10000);
    const inputs = Array.from({ length: 450 }, (_, i) => offer({ id: `product-${i}`, description }, {
      productId: `product-${i}`, sku: `SKU${i}`, gtin: undefined, mpn: `MPN${i}`,
    }));
    const result = createCatalogPreview(inputs);
    expect(result.status).toBe("invalid");
    expect(result).not.toHaveProperty("csv");
    expect(result.invalid[0]?.issues[0]?.code).toBe("output_limit");
  });
  it.each(["not-price", "0.00 EUR", "1e3 EUR", "999999999999999.00 EUR", "1.00 USD"])(
    "rejects forged proposal prices with a static TypeError (%s)", (price) => {
      const result = mapped();
      expect(() => toFeedUpdateProposal({ ...result, item: { ...result.item, price, sale_price: "bad" } })).toThrow(TypeError);
    },
  );
  it("validates sale-price order and currency in forged snapshots", () => {
    const result = mapped();
    for (const sale_price of ["30.00 EUR", "29.90 EUR", "1.00 TRY"]) {
      expect(() => toFeedUpdateProposal({ ...result, item: { ...result.item, sale_price } })).toThrow(TypeError);
    }
  });
  it("clones additional image arrays in both proposal snapshots", () => {
    const result = mapped(); const previous = structuredClone(result.item);
    const proposal = toFeedUpdateProposal(result, previous);
    result.item.additional_image_link?.push("https://example.test/changed.jpg");
    previous.additional_image_link?.push("https://example.test/old.jpg");
    expect(JSON.stringify(proposal)).not.toMatch(/changed.jpg|old.jpg/);
  });
  it("ignores draft duplicate offers while preserving the valid row", () => {
    const result = createCatalogPreview([offer(), offer({ status: "draft" })]);
    expect(result.status).toBe("ready");
    expect(result.mapped).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });
  it("rejects the otherwise-valid member of a duplicate ID with invalid commerce data", () => {
    const result = mapOffers([offer(), offer({}, { priceAmount: 0 })]);
    expect(result.mapped).toHaveLength(0);
    expect(result.invalid).toHaveLength(2);
  });
  it("allows empty optional fields to be omitted, not silently discarded when present", () => {
    mapped(offer({ brand: undefined, material: undefined, pattern: undefined, gender: undefined, ageGroup: undefined }, { color: undefined, size: undefined }));
    invalid(offer({ brand: " " }));
  });
});


it.each(["9812345678902", "19812345678909"])("rejects checksum-valid coupon prefix %s", (gtin) => {
  invalid(offer({}, { gtin }));
});

it("accepts exactly the local batch limit with distinct product records", () => {
  const inputs = Array.from({ length: 1000 }, (_, i) => offer({ id: `p${i}` }, {
    productId: `p${i}`, sku: `SKU${i}`, gtin: undefined, mpn: `MPN${i}`,
  }));
  const result = createCatalogPreview(inputs);
  expect(result.status).toBe("ready");
  expect(result.mapped).toHaveLength(1000);
});

it.each(["\u0085hidden", "\u009bhidden", "\u200b=SECRET()", "\u202e=SECRET()"])("rejects hidden control/formula prefixes (%j)", (description) => {
  invalid(offer({ description }));
});

it("applies length limits after NFC composition and outer whitespace trimming", () => {
  const result = mapped(offer({ title: "\u1100\u1161\u11a8".repeat(500), material: " ".repeat(1000) + "linen" + " ".repeat(1000) }, { color: undefined, size: undefined }));
  expect(result.item.title).toBe("각".repeat(500));
  expect(result.item.material).toBe("linen");
});
