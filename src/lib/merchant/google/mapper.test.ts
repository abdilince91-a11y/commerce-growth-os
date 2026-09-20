import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgeGroupSchema,
  AvailabilitySchema,
  GenderSchema,
  ProductConditionSchema,
  SizeTypeSchema,
} from "@/lib/schema/common";
import {
  AGE_GROUP_MAP,
  ATTRIBUTE_MAX_CODE_POINTS,
  AVAILABILITY_MAP,
  CONDITION_MAP,
  FEED_LABEL_MAX_LENGTH,
  GENDER_MAP,
  MAX_ADDITIONAL_IMAGES,
  MAX_SIZE_TYPES,
  SIZE_SYSTEM_MAP,
  SIZE_TYPE_MAP,
  VARIANT_TITLE_SEPARATOR,
  mapOffer,
  mapOffers,
} from "./mapper";
import type {
  BatchMapResult,
  InvalidOffer,
  MapOfferResult,
  MappedOffer,
  MerchantOfferInput,
  MerchantProductAttributes,
} from "./types";
import type { MerchantIssue } from "./errors";
import { deepFreeze, permutations, shuffled } from "./__fixtures__/helpers";
import {
  CHANNEL_DE,
  CHANNEL_TR,
  GTIN_12,
  GTIN_13,
  GTIN_14,
  GTIN_8,
  IMAGE_1,
  IMAGE_2,
  IMAGE_3,
  OTHER_PRODUCT_ID,
  PRODUCT_ID,
  VARIANT_IMAGE,
  linenShirtOffers,
  linkFor,
  makeOffer,
} from "./__fixtures__/records";

const CANARY = "SECRET-CANARY-8803";
const PREORDER_DATE = new Date("2026-11-01T00:00:00.000Z");

function asMapped(result: MapOfferResult): MappedOffer {
  expect(result.status).toBe("mapped");
  return result as MappedOffer;
}

function asInvalid(result: MapOfferResult): InvalidOffer {
  expect(result.status).toBe("invalid");
  return result as InvalidOffer;
}

function attributesOf(offer: MerchantOfferInput): MerchantProductAttributes {
  return asMapped(mapOffer(offer)).productInput.productAttributes;
}

function pairs(issues: readonly MerchantIssue[]): string[] {
  return issues.map((issue) => `${issue.code}@${issue.path}`).sort();
}

function invalidPairs(offer: MerchantOfferInput): string[] {
  return pairs(asInvalid(mapOffer(offer)).issues);
}

function batchSummary(result: BatchMapResult) {
  return {
    mapped: result.mapped.map((m) => m.productInputId),
    skipped: result.skipped.map((s) => `${s.reason}:${s.variantId}`),
    invalid: result.invalid.map((i) => `${i.productInputId ?? "-"}:${i.variantId ?? "-"}:${pairs(i.issues).join(",")}`),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a valid, active offer", () => {
  it("maps to the complete payload", () => {
    const result = mapOffer(makeOffer());
    expect(result).toEqual({
      status: "mapped",
      productInputId: "tr~TR~LS-BLU-M",
      productInput: {
        offerId: "LS-BLU-M",
        contentLanguage: "tr",
        feedLabel: "TR",
        productAttributes: {
          title: "Linen Shirt - Blue - M",
          description: "A relaxed linen shirt for warm days.",
          link: "https://shop.example.com/products/linen-shirt?variant=LS-BLU-M",
          imageLink: IMAGE_1,
          additionalImageLinks: [IMAGE_2, IMAGE_3],
          price: { amountMicros: "49900000", currencyCode: "EUR" },
          availability: "IN_STOCK",
          condition: "NEW",
          gtins: [GTIN_13],
          brand: "ONOE",
          itemGroupId: PRODUCT_ID,
          color: "Blue",
          size: "M",
          material: "linen",
          pattern: "solid",
          gender: "UNISEX",
          ageGroup: "ADULT",
          sizeSystem: "EU",
          sizeTypes: ["REGULAR"],
        },
      },
      warnings: [],
      productId: PRODUCT_ID,
      variantId: "ckvariantlsbluem0000001",
    });
  });

  it("emits only the fields it has: optional attributes are absent, not undefined", () => {
    const result = asMapped(
      mapOffer(
        makeOffer({
          product: {
            brand: undefined,
            material: undefined,
            pattern: undefined,
            gender: undefined,
            ageGroup: undefined,
            sizeSystem: undefined,
            sizeTypes: [],
            images: [IMAGE_1],
          },
          variant: { color: undefined, size: undefined },
        }),
      ),
    );
    const attributes = result.productInput.productAttributes;
    expect(Object.keys(attributes).sort()).toEqual(
      ["availability", "condition", "description", "gtins", "imageLink", "itemGroupId", "link", "price", "title"].sort(),
    );
    expect(attributes.title).toBe("Linen Shirt");
    expect(result.warnings.map((w) => w.code)).toEqual(["gtin_without_brand"]);
  });

  it("uses Variant.sku as offerId and Product.id verbatim as itemGroupId", () => {
    const result = asMapped(mapOffer(makeOffer({ variant: { sku: "SKU-9" } })));
    expect(result.productInput.offerId).toBe("SKU-9");
    expect(result.productInput.productAttributes.itemGroupId).toBe(PRODUCT_ID);
    expect(result.productInputId).toBe("tr~TR~SKU-9");
  });

  it("puts the channel configuration, not product data, into contentLanguage and feedLabel", () => {
    const result = asMapped(mapOffer(makeOffer({ channel: CHANNEL_DE })));
    expect(result.productInputId).toBe("de~DE~LS-BLU-M");
    expect(result.productInput.contentLanguage).toBe("de");
    expect(result.productInput.feedLabel).toBe("DE");
  });

  it("does not mutate its input and does not alias its arrays", () => {
    const offer = deepFreeze(makeOffer());
    const result = asMapped(mapOffer(offer));
    expect(result.productInput.productAttributes.additionalImageLinks).not.toBe(offer.product.images);
    expect(offer.product.title).toBe("Linen Shirt");
    expect(offer.product.images).toEqual([IMAGE_1, IMAGE_2, IMAGE_3]);
  });

  it("never sends the canonical Product.title itself as the variant title", () => {
    expect(attributesOf(makeOffer()).title).not.toBe("Linen Shirt");
  });
});

describe("prices", () => {
  it("emits only price when there is no compare-at price", () => {
    const attributes = attributesOf(makeOffer({ variant: { priceAmount: 4990 } }));
    expect(attributes.price).toEqual({ amountMicros: "49900000", currencyCode: "EUR" });
    expect("salePrice" in attributes).toBe(false);
  });

  it("emits price = compareAt and salePrice = price when a compare-at price exists", () => {
    const attributes = attributesOf(makeOffer({ variant: { priceAmount: 4990, compareAtPriceAmount: 5990 } }));
    expect(attributes.price).toEqual({ amountMicros: "59900000", currencyCode: "EUR" });
    expect(attributes.salePrice).toEqual({ amountMicros: "49900000", currencyCode: "EUR" });
  });

  it("supports TRY with the same exact conversion", () => {
    const attributes = attributesOf(
      makeOffer({ variant: { currency: "TRY", priceAmount: 1999, compareAtPriceAmount: 2999 } }),
    );
    expect(attributes.price).toEqual({ amountMicros: "29990000", currencyCode: "TRY" });
    expect(attributes.salePrice).toEqual({ amountMicros: "19990000", currencyCode: "TRY" });
  });

  it("returns amountMicros as an exact string even above the safe-integer range", () => {
    const attributes = attributesOf(makeOffer({ variant: { priceAmount: 999999999999 } }));
    expect(attributes.price.amountMicros).toBe("9999999999990000");
  });

  it("supports only EUR and TRY at this adapter boundary", () => {
    for (const currency of ["USD", "JPY", "GBP", "KWD"]) {
      expect(invalidPairs(makeOffer({ variant: { currency } }))).toEqual(["unsupported_currency@variant.currency"]);
    }
  });

  it("reports a malformed currency separately from an unsupported one", () => {
    for (const currency of ["eur", "EU", "EURO", "", "E1R"]) {
      expect(invalidPairs(makeOffer({ variant: { currency } }))).toEqual(["invalid_currency@variant.currency"]);
    }
  });

  it("rejects zero, negative, fractional, and unsafe prices with specific codes", () => {
    const cases: [number, string][] = [
      [0, "price_zero_not_allowed"],
      [-5, "price_negative"],
      [12.5, "price_not_an_integer"],
      [2 ** 53, "price_not_safe_integer"],
      [Number.MAX_SAFE_INTEGER - 1, "price_out_of_range"],
    ];
    for (const [priceAmount, code] of cases) {
      expect(invalidPairs(makeOffer({ variant: { priceAmount } })), String(priceAmount)).toEqual([
        `${code}@variant.priceAmount`,
      ]);
    }
  });

  it("rejects a compare-at price that is not strictly greater", () => {
    for (const compareAtPriceAmount of [4990, 4989, 1]) {
      expect(invalidPairs(makeOffer({ variant: { priceAmount: 4990, compareAtPriceAmount } }))).toEqual([
        "invalid_compare_at_price@variant.compareAtPriceAmount",
      ]);
    }
  });

  it("reports a bad compare-at value with the price code, without inventing a sale price", () => {
    expect(invalidPairs(makeOffer({ variant: { priceAmount: 4990, compareAtPriceAmount: 0.5 } }))).toEqual([
      "invalid_compare_at_price@variant.compareAtPriceAmount",
    ]);
  });
});

describe("explicit mapping tables", () => {
  it("map every canonical value, and nothing else", () => {
    expect(Object.keys(AVAILABILITY_MAP).sort()).toEqual([...AvailabilitySchema.options].sort());
    expect(Object.keys(CONDITION_MAP).sort()).toEqual([...ProductConditionSchema.options].sort());
    expect(Object.keys(GENDER_MAP).sort()).toEqual([...GenderSchema.options].sort());
    expect(Object.keys(AGE_GROUP_MAP).sort()).toEqual([...AgeGroupSchema.options].sort());
    expect(Object.keys(SIZE_TYPE_MAP).sort()).toEqual([...SizeTypeSchema.options].sort());
  });

  it("are exactly the documented canonical -> Merchant spellings", () => {
    expect(AVAILABILITY_MAP).toEqual({
      in_stock: "IN_STOCK",
      out_of_stock: "OUT_OF_STOCK",
      preorder: "PREORDER",
      backorder: "BACKORDER",
    });
    expect(CONDITION_MAP).toEqual({ new: "NEW", used: "USED", refurbished: "REFURBISHED" });
    expect(GENDER_MAP).toEqual({ male: "MALE", female: "FEMALE", unisex: "UNISEX" });
    expect(AGE_GROUP_MAP).toEqual({
      newborn: "NEWBORN",
      infant: "INFANT",
      toddler: "TODDLER",
      child: "KIDS",
      adult: "ADULT",
    });
    expect(SIZE_TYPE_MAP).toEqual({
      regular: "REGULAR",
      petite: "PETITE",
      plus: "PLUS",
      tall: "TALL",
      maternity: "MATERNITY",
    });
    expect(SIZE_SYSTEM_MAP).toEqual({
      us: "US", uk: "UK", eu: "EU", de: "DE", fr: "FR", jp: "JP", cn: "CN", it: "IT", br: "BR", mx: "MEX", au: "AU",
    });
  });

  it.each([
    ["in_stock", "IN_STOCK"],
    ["out_of_stock", "OUT_OF_STOCK"],
    ["preorder", "PREORDER"],
    ["backorder", "BACKORDER"],
  ])("maps availability %s to %s", (canonical, expected) => {
    const attributes = attributesOf(
      makeOffer({ variant: { availability: canonical as never, availabilityDate: PREORDER_DATE } }),
    );
    expect(attributes.availability).toBe(expected);
  });

  it.each([
    ["new", "NEW"],
    ["used", "USED"],
    ["refurbished", "REFURBISHED"],
  ])("maps condition %s to %s", (canonical, expected) => {
    expect(attributesOf(makeOffer({ product: { condition: canonical as never } })).condition).toBe(expected);
  });

  it.each([
    ["male", "MALE"],
    ["female", "FEMALE"],
    ["unisex", "UNISEX"],
  ])("maps gender %s to %s", (canonical, expected) => {
    expect(attributesOf(makeOffer({ product: { gender: canonical as never } })).gender).toBe(expected);
  });

  it.each([
    ["newborn", "NEWBORN"],
    ["infant", "INFANT"],
    ["toddler", "TODDLER"],
    ["child", "KIDS"],
    ["adult", "ADULT"],
  ])("maps ageGroup %s to %s", (canonical, expected) => {
    expect(attributesOf(makeOffer({ product: { ageGroup: canonical as never } })).ageGroup).toBe(expected);
  });

  it.each([
    ["us", "US"], ["uk", "UK"], ["eu", "EU"], ["de", "DE"], ["fr", "FR"], ["jp", "JP"],
    ["cn", "CN"], ["it", "IT"], ["br", "BR"], ["mx", "MEX"], ["au", "AU"],
  ])("maps sizeSystem %s to %s", (canonical, expected) => {
    expect(attributesOf(makeOffer({ product: { sizeSystem: canonical } })).sizeSystem).toBe(expected);
  });

  it("keeps sizeTypes in order, and allows at most two", () => {
    expect(attributesOf(makeOffer({ product: { sizeTypes: ["petite", "regular"] } })).sizeTypes).toEqual([
      "PETITE",
      "REGULAR",
    ]);
    expect(MAX_SIZE_TYPES).toBe(2);
    expect(invalidPairs(makeOffer({ product: { sizeTypes: ["regular", "petite", "plus"] } }))).toEqual([
      "too_many_size_types@product.sizeTypes",
    ]);
  });

  it("omits an empty sizeTypes list", () => {
    expect("sizeTypes" in attributesOf(makeOffer({ product: { sizeTypes: [] } }))).toBe(false);
  });

  it("warns and leaves out a size system Merchant has no equivalent for", () => {
    const result = asMapped(mapOffer(makeOffer({ product: { sizeSystem: "tr" } })));
    expect("sizeSystem" in result.productInput.productAttributes).toBe(false);
    expect(pairs(result.warnings)).toEqual(["unmapped_attribute@product.sizeSystem"]);
  });

  it("rejects values outside the canonical enums, including Merchant's own uppercase spellings", () => {
    const cases: [MerchantOfferInput, string][] = [
      [makeOffer({ variant: { availability: "IN_STOCK" as never } }), "invalid_enum_value@variant.availability"],
      [makeOffer({ product: { condition: "NEW" as never } }), "invalid_enum_value@product.condition"],
      [makeOffer({ product: { gender: "MALE" as never } }), "invalid_enum_value@product.gender"],
      [makeOffer({ product: { ageGroup: "KIDS" as never } }), "invalid_enum_value@product.ageGroup"],
      [makeOffer({ product: { sizeTypes: ["REGULAR"] as never } }), "invalid_enum_value@product.sizeTypes"],
    ];
    for (const [offer, expected] of cases) expect(invalidPairs(offer)).toEqual([expected]);
  });

  it("is not fooled by prototype keys", () => {
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(invalidPairs(makeOffer({ variant: { availability: key as never } }))).toEqual([
        "invalid_enum_value@variant.availability",
      ]);
      expect(invalidPairs(makeOffer({ product: { condition: key as never } }))).toEqual([
        "invalid_enum_value@product.condition",
      ]);
    }
  });
});

describe("identifiers", () => {
  it("validates the offerId (Variant.sku) with the Slice 1 rules and a field path", () => {
    for (const sku of ["A B", "A~B", "A/B", "A%B", "", "a".repeat(51)]) {
      expect(invalidPairs(makeOffer({ variant: { sku } })), JSON.stringify(sku)).toEqual(["invalid_offer_id@variant.sku"]);
    }
  });

  it("accepts a 50-code-point Unicode sku", () => {
    expect(asMapped(mapOffer(makeOffer({ variant: { sku: "🧵".repeat(50) } }))).productInput.offerId).toBe("🧵".repeat(50));
  });

  it("validates the channel configuration", () => {
    expect(invalidPairs(makeOffer({ channel: { contentLanguage: "TR", feedLabel: "TR" } }))).toEqual([
      "invalid_content_language@channel.contentLanguage",
    ]);
    expect(invalidPairs(makeOffer({ channel: { contentLanguage: "tr", feedLabel: "tr" } }))).toEqual([
      "invalid_feed_label@channel.feedLabel",
    ]);
    expect(invalidPairs(makeOffer({ channel: { contentLanguage: "tr", feedLabel: "T~R" } }))).toEqual([
      "invalid_feed_label@channel.feedLabel",
    ]);
  });

  it("limits feedLabel to 20 characters, as Merchant does", () => {
    expect(FEED_LABEL_MAX_LENGTH).toBe(20);
    expect(asMapped(mapOffer(makeOffer({ channel: { contentLanguage: "tr", feedLabel: "A".repeat(20) } }))).productInputId).toBe(
      `tr~${"A".repeat(20)}~LS-BLU-M`,
    );
    expect(invalidPairs(makeOffer({ channel: { contentLanguage: "tr", feedLabel: "A".repeat(21) } }))).toEqual([
      "feed_label_too_long@channel.feedLabel",
    ]);
  });

  it("requires the variant to belong to the product", () => {
    expect(invalidPairs(makeOffer({ variant: { productId: OTHER_PRODUCT_ID } }))).toEqual([
      "variant_product_mismatch@variant.productId",
    ]);
  });

  it("requires stable ids on both records", () => {
    expect(invalidPairs(makeOffer({ product: { id: "" }, variant: { productId: "" } }))).toEqual(
      ["missing_required_field@product.id", "missing_required_field@variant.productId"].sort(),
    );
    expect(invalidPairs(makeOffer({ variant: { id: "" } }))).toEqual(["missing_required_field@variant.id"]);
  });

  it("checks the pairing before lifecycle, so a mismatched draft is invalid, not skipped", () => {
    expect(
      invalidPairs(makeOffer({ product: { status: "draft" }, variant: { productId: OTHER_PRODUCT_ID } })),
    ).toEqual(["variant_product_mismatch@variant.productId"]);
  });

  it("refuses an id that cannot be an itemGroupId (over 50 code points or control characters)", () => {
    const long = "p".repeat(51);
    expect(invalidPairs(makeOffer({ product: { id: long }, variant: { productId: long } }))).toEqual([
      "invalid_item_group_id@product.id",
    ]);
    const control = "p\u0007q";
    expect(invalidPairs(makeOffer({ product: { id: control }, variant: { productId: control } }))).toEqual([
      "invalid_item_group_id@product.id",
    ]);
  });
});

describe("variant title (derived; Product.title stays canonical)", () => {
  it("appends the variant's own color and size, separated by ' - '", () => {
    expect(VARIANT_TITLE_SEPARATOR).toBe(" - ");
    expect(attributesOf(makeOffer()).title).toBe("Linen Shirt - Blue - M");
    expect(attributesOf(makeOffer({ variant: { size: undefined } })).title).toBe("Linen Shirt - Blue");
    expect(attributesOf(makeOffer({ variant: { color: undefined } })).title).toBe("Linen Shirt - M");
    expect(attributesOf(makeOffer({ variant: { color: undefined, size: undefined } })).title).toBe("Linen Shirt");
  });

  it("depends only on the variant itself, not on its siblings", () => {
    const alone = attributesOf(makeOffer());
    const inBatch = asMapped(mapOffers(linenShirtOffers()).mapped.find((m) => m.productInputId === "tr~TR~LS-BLU-M") as MappedOffer);
    expect(inBatch.productInput.productAttributes.title).toBe(alone.title);
  });

  it("normalizes with NFC and trims, changing nothing else", () => {
    const attributes = attributesOf(
      makeOffer({
        product: { title: "  Café Bag  ", description: "  Café au lait  " },
        variant: { color: "  Noir  ", size: " M " },
      }),
    );
    expect(attributes.title).toBe("Café Bag - Noir - M");
    expect(attributes.description).toBe("Café au lait");
    expect(attributes.color).toBe("Noir");
    expect(attributes.size).toBe("M");
  });

  it("treats NFC and NFD forms of the same text identically", () => {
    const nfc = "Çanta Şık".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(attributesOf(makeOffer({ product: { title: nfd } })).title).toBe(attributesOf(makeOffer({ product: { title: nfc } })).title);
  });

  it.each([
    ["Turkish, with dotted and dotless i", "İstanbul Çanta ığüşö", "Lacivert", "Tek Ebat"],
    ["CJK", "麻のシャツ", "青", "M"],
    ["right-to-left Arabic", "قميص كتان", "أزرق", "M"],
    ["right-to-left Hebrew", "חולצת פשתן", "כחול", "L"],
    ["emoji and ZWJ sequences", "Family 👨‍👩‍👧 Shirt 🧵", "Blue 💙", "M"],
  ])("keeps %s exactly, changing no case", (_name, title, color, size) => {
    const attributes = attributesOf(makeOffer({ product: { title }, variant: { color, size } }));
    expect(attributes.title).toBe(`${title} - ${color} - ${size}`);
    expect(attributes.color).toBe(color);
  });

  it("counts code points and rejects (never truncates) at the 150 boundary", () => {
    // derived title length = title + 3 (" - ") + "Blue" (4) + 3 + "M" (1) = title + 11
    const atLimit = attributesOf(makeOffer({ product: { title: "a".repeat(139) } }));
    expect(Array.from(atLimit.title)).toHaveLength(150);
    expect(invalidPairs(makeOffer({ product: { title: "a".repeat(140) } }))).toEqual(["title_too_long@product.title"]);
  });

  it("counts an emoji as one code point at the boundary", () => {
    const atLimit = attributesOf(makeOffer({ product: { title: "😀".repeat(139) } }));
    expect(Array.from(atLimit.title)).toHaveLength(150);
    expect(atLimit.title.length).toBe(150 + 139);
    expect(invalidPairs(makeOffer({ product: { title: "😀".repeat(140) } }))).toEqual(["title_too_long@product.title"]);
  });

  it("counts after composition: decomposed accents do not count twice", () => {
    const decomposed = "é".repeat(139);
    expect(Array.from(decomposed)).toHaveLength(278);
    expect(Array.from(attributesOf(makeOffer({ product: { title: decomposed } })).title)).toHaveLength(150);
  });

  it("enforces the 5000 code-point description limit exactly", () => {
    expect(attributesOf(makeOffer({ product: { description: "😀".repeat(5000) } })).description).toBe("😀".repeat(5000));
    expect(invalidPairs(makeOffer({ product: { description: "😀".repeat(5001) } }))).toEqual([
      "description_too_long@product.description",
    ]);
  });

  it("rejects blank and malformed text with static codes", () => {
    expect(invalidPairs(makeOffer({ product: { title: "   " } }))).toEqual(["text_empty@product.title"]);
    expect(invalidPairs(makeOffer({ product: { description: "" } }))).toEqual(["text_empty@product.description"]);
    expect(invalidPairs(makeOffer({ product: { title: "bad \uD800 text" } }))).toEqual(["malformed_unicode@product.title"]);
    expect(invalidPairs(makeOffer({ product: { title: 42 as never } }))).toEqual(["invalid_text@product.title"]);
  });

  it("enforces Merchant's attribute lengths at the exact boundary", () => {
    expect(ATTRIBUTE_MAX_CODE_POINTS).toEqual({ brand: 70, mpn: 70, color: 100, size: 100, pattern: 100, material: 200 });
    const cases: [Parameters<typeof makeOffer>[0], string][] = [
      [{ product: { brand: "b".repeat(71) } }, "attribute_too_long@product.brand"],
      [{ variant: { mpn: "m".repeat(71) } }, "attribute_too_long@variant.mpn"],
      [{ variant: { color: "c".repeat(101) } }, "attribute_too_long@variant.color"],
      [{ variant: { size: "s".repeat(101) } }, "attribute_too_long@variant.size"],
      [{ product: { pattern: "p".repeat(101) } }, "attribute_too_long@product.pattern"],
      [{ product: { material: "m".repeat(201) } }, "attribute_too_long@product.material"],
    ];
    for (const [overrides, expected] of cases) expect(invalidPairs(makeOffer(overrides))).toEqual([expected]);
    for (const overrides of [
      { product: { brand: "b".repeat(70) } },
      { variant: { mpn: "m".repeat(70) } },
      { variant: { color: "c".repeat(100) } },
      { variant: { size: "s".repeat(100) } },
      { product: { pattern: "p".repeat(100) } },
      { product: { material: "m".repeat(200) } },
    ]) {
      expect(asMapped(mapOffer(makeOffer(overrides))).status).toBe("mapped");
    }
  });
});

describe("images", () => {
  it("uses the first product image and keeps the rest in order", () => {
    const attributes = attributesOf(makeOffer());
    expect(attributes.imageLink).toBe(IMAGE_1);
    expect(attributes.additionalImageLinks).toEqual([IMAGE_2, IMAGE_3]);
  });

  it("prefers the variant image and then lists all product images in order", () => {
    const attributes = attributesOf(makeOffer({ variant: { imageUrl: VARIANT_IMAGE } }));
    expect(attributes.imageLink).toBe(VARIANT_IMAGE);
    expect(attributes.additionalImageLinks).toEqual([IMAGE_1, IMAGE_2, IMAGE_3]);
  });

  it("does not repeat the primary image among the additional ones", () => {
    const attributes = attributesOf(makeOffer({ variant: { imageUrl: IMAGE_2 } }));
    expect(attributes.imageLink).toBe(IMAGE_2);
    expect(attributes.additionalImageLinks).toEqual([IMAGE_1, IMAGE_3]);
    const repeated = attributesOf(makeOffer({ product: { images: [IMAGE_1, IMAGE_2, IMAGE_1] } }));
    expect(repeated.additionalImageLinks).toEqual([IMAGE_2]);
  });

  it("omits additionalImageLinks when there are none", () => {
    expect("additionalImageLinks" in attributesOf(makeOffer({ product: { images: [IMAGE_1] } }))).toBe(false);
    expect("additionalImageLinks" in attributesOf(makeOffer({ product: { images: [IMAGE_1] }, variant: { imageUrl: IMAGE_1 } }))).toBe(false);
  });

  it("returns URLs exactly as supplied, keeping query parameters", () => {
    const withQuery = "https://cdn.example.com/a.jpg?w=800&utm_source=x";
    const attributes = attributesOf(makeOffer({ product: { images: [withQuery, `${withQuery}#2`] } }));
    expect(attributes.imageLink).toBe(withQuery);
    expect(attributes.additionalImageLinks).toEqual([`${withQuery}#2`]);
  });

  it("allows up to 10 additional images and rejects the 11th", () => {
    expect(MAX_ADDITIONAL_IMAGES).toBe(10);
    const image = (n: number) => `https://cdn.example.com/i/${n}.jpg`;
    const eleven = Array.from({ length: 11 }, (_v, i) => image(i));
    expect(attributesOf(makeOffer({ product: { images: eleven } })).additionalImageLinks).toHaveLength(10);
    const twelve = Array.from({ length: 12 }, (_v, i) => image(i));
    expect(invalidPairs(makeOffer({ product: { images: twelve } }))).toEqual(["too_many_images@product.images"]);
  });

  it("requires at least one image", () => {
    expect(invalidPairs(makeOffer({ product: { images: [] } }))).toEqual(["missing_image@product.images"]);
    expect(asMapped(mapOffer(makeOffer({ product: { images: [] }, variant: { imageUrl: VARIANT_IMAGE } }))).status).toBe("mapped");
  });

  it("validates every image with the Slice 1 URL rules and reports the exact path", () => {
    const cases: [Parameters<typeof makeOffer>[0], string][] = [
      [{ product: { images: [IMAGE_1, "javascript:alert(1)"] } }, "unsafe_url_scheme@product.images[1]"],
      [{ product: { images: ["data:image/png;base64,AAAA"] } }, "unsafe_url_scheme@product.images[0]"],
      [{ product: { images: [IMAGE_1, "https://user:pw@cdn.example.com/a.jpg"] } }, "url_has_credentials@product.images[1]"],
      [{ product: { images: ["/relative/a.jpg"] } }, "invalid_url@product.images[0]"],
      [{ variant: { imageUrl: "ftp://cdn.example.com/a.jpg" } }, "unsafe_url_scheme@variant.imageUrl"],
      [{ variant: { imageUrl: "https://cdn.example.com/a b.jpg" } }, "invalid_url@variant.imageUrl"],
    ];
    for (const [overrides, expected] of cases) expect(invalidPairs(makeOffer(overrides))).toEqual([expected]);
  });

  it("still validates shared images when a variant image is used", () => {
    expect(invalidPairs(makeOffer({ product: { images: [IMAGE_1, "javascript:x"] }, variant: { imageUrl: VARIANT_IMAGE } }))).toEqual([
      "unsafe_url_scheme@product.images[1]",
    ]);
  });
});

describe("link (storefront context, never derived)", () => {
  it("passes the supplied link through exactly", () => {
    const link = "https://shop.example.com/products/x?variant=1&utm_source=feed#top";
    expect(attributesOf(makeOffer({ link })).link).toBe(link);
  });

  it("never derives the link from the product handle or sku", () => {
    const a = attributesOf(makeOffer({ product: { handle: "handle-one" }, link: "https://shop.example.com/a" }));
    const b = attributesOf(makeOffer({ product: { handle: "handle-two" }, link: "https://shop.example.com/a" }));
    expect(a.link).toBe("https://shop.example.com/a");
    expect(b.link).toBe("https://shop.example.com/a");
    expect(attributesOf(makeOffer({ link: "https://shop.example.com/z" })).link).not.toContain("LS-BLU-M");
  });

  it("rejects unsafe, relative, credentialed, and non-string links", () => {
    const cases: [unknown, string][] = [
      ["javascript:alert(1)", "unsafe_url_scheme@link"],
      ["data:text/html,hi", "unsafe_url_scheme@link"],
      ["ftp://shop.example.com/x", "unsafe_url_scheme@link"],
      ["/products/linen-shirt", "invalid_url@link"],
      ["", "invalid_url@link"],
      [" https://shop.example.com/x", "invalid_url@link"],
      ["https://user:pw@shop.example.com/x", "url_has_credentials@link"],
      [undefined, "invalid_url@link"],
      [42, "invalid_url@link"],
    ];
    for (const [link, expected] of cases) {
      expect(invalidPairs({ ...makeOffer(), link: link as never }), String(link)).toEqual([expected]);
    }
  });
});

describe("availability dates", () => {
  it.each(["preorder", "backorder"])("requires a date for %s and formats it as UTC ISO 8601", (availability) => {
    const attributes = attributesOf(makeOffer({ variant: { availability: availability as never, availabilityDate: PREORDER_DATE } }));
    expect(attributes.availabilityDate).toBe("2026-11-01T00:00:00.000Z");
    expect(invalidPairs(makeOffer({ variant: { availability: availability as never } }))).toEqual([
      "missing_availability_date@variant.availabilityDate",
    ]);
  });

  it("rejects an invalid date object and a non-Date value", () => {
    for (const availabilityDate of [new Date("not a date"), "2026-11-01", 1793491200000, null]) {
      expect(
        invalidPairs(makeOffer({ variant: { availability: "preorder", availabilityDate: availabilityDate as never } })),
      ).toEqual(["invalid_availability_date@variant.availabilityDate"]);
    }
  });

  it("ignores, with a warning, a date on an offer that is not a preorder or backorder", () => {
    for (const availability of ["in_stock", "out_of_stock"]) {
      const result = asMapped(mapOffer(makeOffer({ variant: { availability: availability as never, availabilityDate: PREORDER_DATE } })));
      expect("availabilityDate" in result.productInput.productAttributes).toBe(false);
      expect(pairs(result.warnings)).toEqual(["availability_date_ignored@variant.availabilityDate"]);
    }
  });

  it("emits no date key when there is none", () => {
    expect("availabilityDate" in attributesOf(makeOffer())).toBe(false);
  });
});

describe("identifiers: GTIN, MPN and brand", () => {
  it("passes a valid GTIN of each length through exactly as supplied", () => {
    for (const gtin of [GTIN_8, GTIN_12, GTIN_13, GTIN_14]) {
      expect(attributesOf(makeOffer({ variant: { gtin } })).gtins).toEqual([gtin]);
    }
    expect(attributesOf(makeOffer({ variant: { gtin: GTIN_12 } })).gtins).not.toEqual(attributesOf(makeOffer({ variant: { gtin: GTIN_13 } })).gtins);
  });

  it("never trims, strips separators from, pads, or rewrites a GTIN: it rejects it", () => {
    const cases: [string, string][] = [
      [` ${GTIN_13}`, "gtin_not_digits"],
      [`${GTIN_13} `, "gtin_not_digits"],
      ["0012-3456-78905", "gtin_not_digits"],
      ["0012 345678905", "gtin_not_digits"],
      ["12345678905", "gtin_bad_length"],
      ["0012345678906", "gtin_bad_check_digit"],
      ["00000000", "gtin_all_zeros"],
    ];
    for (const [gtin, code] of cases) {
      expect(invalidPairs(makeOffer({ variant: { gtin } })), gtin).toEqual([`${code}@variant.gtin`]);
    }
  });

  it("rejects a coupon-prefixed GTIN", () => {
    expect(invalidPairs(makeOffer({ variant: { gtin: "9812345678901" } }))).toEqual(["gtin_bad_check_digit@variant.gtin"]);
    const coupon = "9800000000007"; // valid GS1 check digit, 98 coupon prefix
    expect(invalidPairs(makeOffer({ variant: { gtin: coupon } }))).toEqual(["gtin_coupon_prefix@variant.gtin"]);
  });

  it("warns, but still maps, a GTIN without a brand", () => {
    const result = asMapped(mapOffer(makeOffer({ product: { brand: undefined } })));
    expect(pairs(result.warnings)).toEqual(["gtin_without_brand@variant.gtin"]);
    expect(result.warnings[0]?.severity).toBe("warning");
    expect(result.warnings[0]?.offerId).toBe("LS-BLU-M");
    expect("brand" in result.productInput.productAttributes).toBe(false);
  });

  it("gives no warning when a brand is present", () => {
    expect(asMapped(mapOffer(makeOffer())).warnings).toEqual([]);
  });

  it("treats an MPN without a brand as an error", () => {
    expect(invalidPairs(makeOffer({ product: { brand: undefined }, variant: { gtin: undefined, mpn: "MPN-1" } }))).toEqual([
      "mpn_requires_brand@variant.mpn",
    ]);
  });

  it("reports both the MPN error and the GTIN warning when there is no brand", () => {
    const result = asInvalid(mapOffer(makeOffer({ product: { brand: undefined }, variant: { mpn: "MPN-1" } })));
    expect(pairs(result.issues)).toEqual(["gtin_without_brand@variant.gtin", "mpn_requires_brand@variant.mpn"]);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(1);
  });

  it("emits mpn with a brand, alone or beside a GTIN", () => {
    const both = attributesOf(makeOffer({ variant: { mpn: "MPN-1" } }));
    expect(both.mpn).toBe("MPN-1");
    expect(both.gtins).toEqual([GTIN_13]);
    const mpnOnly = attributesOf(makeOffer({ variant: { gtin: undefined, mpn: "MPN-1" } }));
    expect(mpnOnly.mpn).toBe("MPN-1");
    expect("gtins" in mpnOnly).toBe(false);
  });

  it("requires at least one of gtin or mpn", () => {
    expect(invalidPairs(makeOffer({ variant: { gtin: undefined, mpn: undefined } }))).toEqual([
      "missing_identifier@variant.gtin",
    ]);
  });
});

describe("lifecycle: draft and archived records are skipped, not invalid", () => {
  it.each([
    ["product draft", { product: { status: "draft" as const } }, "product_draft"],
    ["product archived", { product: { status: "archived" as const } }, "product_archived"],
    ["variant draft", { variant: { status: "draft" as const } }, "variant_draft"],
    ["variant archived", { variant: { status: "archived" as const } }, "variant_archived"],
  ])("returns skipped for %s", (_name, overrides, reason) => {
    expect(mapOffer(makeOffer(overrides))).toEqual({
      status: "skipped",
      reason,
      productId: PRODUCT_ID,
      variantId: "ckvariantlsbluem0000001",
    });
  });

  it("reports the product's state first when both are inactive", () => {
    const result = mapOffer(makeOffer({ product: { status: "archived" }, variant: { status: "draft" } }));
    expect(result).toMatchObject({ status: "skipped", reason: "product_archived" });
  });

  it("skips an incomplete draft without validating its content", () => {
    const result = mapOffer(
      makeOffer({
        product: { status: "draft", title: "", images: [], description: "" },
        variant: { currency: "usd", priceAmount: 0, gtin: undefined },
        link: "not a url",
      }),
    );
    expect(result.status).toBe("skipped");
  });

  it("maps a fully active offer", () => {
    expect(mapOffer(makeOffer({ product: { status: "active" }, variant: { status: "active" } })).status).toBe("mapped");
  });

  it("rejects an unknown lifecycle value as invalid", () => {
    expect(invalidPairs(makeOffer({ product: { status: "ACTIVE" as never } }))).toEqual(["invalid_enum_value@product.status"]);
    expect(invalidPairs(makeOffer({ variant: { status: "live" as never } }))).toEqual(["invalid_enum_value@variant.status"]);
  });
});

describe("issue collection", () => {
  it("collects every problem in one pass, each with its own path", () => {
    const offer = makeOffer({
      product: { title: "", description: "", images: [], condition: "NEW" as never, brand: undefined },
      variant: { sku: "A B", currency: "usd", priceAmount: 0, gtin: "123", mpn: "M".repeat(71), availability: "preorder" },
      channel: { contentLanguage: "TR", feedLabel: "t" },
      link: "/relative",
    });
    expect(invalidPairs(offer)).toEqual(
      [
        "attribute_too_long@variant.mpn",
        "gtin_bad_length@variant.gtin",
        "invalid_content_language@channel.contentLanguage",
        "invalid_currency@variant.currency",
        "invalid_enum_value@product.condition",
        "invalid_feed_label@channel.feedLabel",
        "invalid_offer_id@variant.sku",
        "invalid_url@link",
        "missing_availability_date@variant.availabilityDate",
        "missing_image@product.images",
        "mpn_requires_brand@variant.mpn",
        "text_empty@product.description",
        "text_empty@product.title",
      ].sort(),
    );
  });

  it("returns errors and warnings together in an invalid result", () => {
    const result = asInvalid(mapOffer(makeOffer({ product: { brand: undefined, images: [] } })));
    expect(pairs(result.issues)).toEqual(["gtin_without_brand@variant.gtin", "missing_image@product.images"]);
  });

  it("carries a sanitized offerId only when the SKU is valid", () => {
    const good = asInvalid(mapOffer(makeOffer({ product: { title: "" } })));
    expect(good.issues.every((i) => i.offerId === "LS-BLU-M")).toBe(true);
    const bad = asInvalid(mapOffer(makeOffer({ variant: { sku: `bad ${CANARY}` } })));
    expect(bad.issues.every((i) => i.offerId === undefined)).toBe(true);
  });

  it("carries ids and productInputId on an invalid result when they are valid", () => {
    const result = asInvalid(mapOffer(makeOffer({ product: { title: "" } })));
    expect(result.productInputId).toBe("tr~TR~LS-BLU-M");
    expect(result.productId).toBe(PRODUCT_ID);
    expect(result.variantId).toBe("ckvariantlsbluem0000001");
    const noId = asInvalid(mapOffer(makeOffer({ variant: { sku: "A B" } })));
    expect(noId.productInputId).toBeUndefined();
  });

  it("never returns an unreadable input as a throw", () => {
    for (const input of [null, undefined, 42, "x", [], {}, { product: null, variant: null, channel: null, link: "x" }]) {
      const result = mapOffer(input as never);
      expect(result.status).toBe("invalid");
    }
    const hostile = { get product(): never { throw new Error("boom"); }, variant: {}, channel: {}, link: "x" };
    expect(asInvalid(mapOffer(hostile as never)).issues.map((i) => i.code)).toEqual(["unreadable_input"]);
    const proxy = new Proxy({}, { get() { throw new Error("boom"); } });
    expect(() => mapOffer({ product: proxy, variant: proxy, channel: proxy, link: "x" } as never)).not.toThrow();
  });
});

describe("no raw value ever appears in an issue", () => {
  it("keeps titles, descriptions, URLs, SKUs, GTINs and attributes out of messages and paths", () => {
    const offers: MerchantOfferInput[] = [
      makeOffer({ product: { title: `${CANARY}${"x".repeat(200)}` } }),
      makeOffer({ product: { description: `${CANARY}`.repeat(1000) } }),
      makeOffer({ link: `https://user:${CANARY}@host-${CANARY}.example.com/p?token=${CANARY}` }),
      makeOffer({ link: `javascript:alert('${CANARY}')` }),
      makeOffer({ product: { images: [`https://x.example.com/${CANARY}/a b.jpg`] } }),
      makeOffer({ variant: { sku: `bad ${CANARY}` } }),
      makeOffer({ variant: { gtin: `${CANARY}123` } }),
      makeOffer({ variant: { gtin: undefined, mpn: `${CANARY}`.repeat(20) } }),
      makeOffer({ product: { brand: CANARY.repeat(20) } }),
      makeOffer({ product: { material: CANARY.repeat(40) } }),
      makeOffer({ variant: { color: CANARY.repeat(20) } }),
      makeOffer({ variant: { currency: CANARY } }),
      makeOffer({ variant: { availability: CANARY as never } }),
      makeOffer({ channel: { contentLanguage: CANARY, feedLabel: CANARY } }),
      makeOffer({ product: { id: CANARY.repeat(5) }, variant: { productId: `${CANARY}other` } }),
    ];
    for (const offer of offers) {
      const result = mapOffer(offer);
      expect(result.status).toBe("invalid");
      const serialized = JSON.stringify((result as InvalidOffer).issues);
      expect(serialized).not.toContain(CANARY);
      expect(serialized).not.toContain("example.com");
      expect(serialized).not.toContain("token=");
    }
  });
});

describe("batch mapping", () => {
  it("maps a product family and sorts the output by productInputId", () => {
    const result = mapOffers(linenShirtOffers());
    expect(result.skipped).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(result.mapped.map((m) => m.productInputId)).toEqual(["tr~TR~LS-BLU-L", "tr~TR~LS-BLU-M", "tr~TR~LS-RED-M"]);
    expect(result.mapped.map((m) => m.productInput.productAttributes.title)).toEqual([
      "Linen Shirt - Blue - L",
      "Linen Shirt - Blue - M",
      "Linen Shirt - Red - M",
    ]);
    expect(new Set(result.mapped.map((m) => m.productInput.productAttributes.itemGroupId))).toEqual(new Set([PRODUCT_ID]));
  });

  it("gives every variant of one product the same itemGroupId and its own offerId", () => {
    const result = mapOffers(linenShirtOffers());
    expect(result.mapped.map((m) => m.productInput.offerId)).toEqual(["LS-BLU-L", "LS-BLU-M", "LS-RED-M"]);
  });

  it("separates mapped, skipped, and invalid offers", () => {
    const offers = [
      ...linenShirtOffers(),
      makeOffer({ variant: { id: "ckvariantdraft0000000004", sku: "LS-DRAFT", status: "draft", gtin: GTIN_8, color: "Green" } }),
      makeOffer({ variant: { id: "ckvariantbad00000000005", sku: "LS-BAD", gtin: GTIN_8, color: "Black", priceAmount: 0 } }),
    ];
    const result = mapOffers(offers);
    expect(result.mapped).toHaveLength(3);
    expect(result.skipped).toEqual([
      { status: "skipped", reason: "variant_draft", productId: PRODUCT_ID, variantId: "ckvariantdraft0000000004" },
    ]);
    expect(result.invalid).toHaveLength(1);
    expect(pairs((result.invalid[0] as InvalidOffer).issues)).toEqual(["price_zero_not_allowed@variant.priceAmount"]);
  });

  it("rejects every offer that shares an offerId within a contentLanguage/feedLabel scope", () => {
    const offers = [
      makeOffer({ variant: { id: "v1", sku: "DUP", gtin: GTIN_13, color: "Blue", size: "M" } }),
      makeOffer({ variant: { id: "v2", sku: "DUP", gtin: GTIN_12, color: "Red", size: "M" } }),
      makeOffer({ variant: { id: "v3", sku: "UNIQUE", gtin: GTIN_14, color: "Green", size: "M" } }),
    ];
    const result = mapOffers(offers);
    expect(result.mapped.map((m) => m.productInput.offerId)).toEqual(["UNIQUE"]);
    expect(result.invalid.map((i) => pairs(i.issues))).toEqual([
      ["duplicate_offer_id@variant.sku"],
      ["duplicate_offer_id@variant.sku"],
    ]);
  });

  it("does not treat the same offerId in a different feed scope as a duplicate", () => {
    const result = mapOffers([
      makeOffer({ variant: { id: "v1", sku: "SAME" }, channel: CHANNEL_TR }),
      makeOffer({ variant: { id: "v2", sku: "SAME" }, channel: CHANNEL_DE }),
    ]);
    expect(result.invalid).toEqual([]);
    expect(result.mapped.map((m) => m.productInputId)).toEqual(["de~DE~SAME", "tr~TR~SAME"]);
  });

  it("applies the color/size and currency rules per feed scope, so one variant can be published to several channels", () => {
    const variant = { id: "v1", sku: "SAME", color: "Blue", size: "M" };
    const result = mapOffers([
      makeOffer({ variant, channel: CHANNEL_TR }),
      makeOffer({ variant: { ...variant, currency: "TRY" }, channel: CHANNEL_DE }),
    ]);
    expect(result.invalid).toEqual([]);
    // Sorted by productInputId: "de~DE~SAME" (TRY) then "tr~TR~SAME" (EUR).
    expect(result.mapped.map((m) => m.productInput.productAttributes.price.currencyCode)).toEqual(["TRY", "EUR"]);
  });

  it("still rejects a repeated color/size inside one feed scope", () => {
    const sameScope = mapOffers([
      makeOffer({ variant: { id: "v1", sku: "A", gtin: GTIN_13, color: "Blue", size: "M" }, channel: CHANNEL_DE }),
      makeOffer({ variant: { id: "v2", sku: "B", gtin: GTIN_12, color: "Blue", size: "M" }, channel: CHANNEL_DE }),
      makeOffer({ variant: { id: "v3", sku: "C", gtin: GTIN_14, color: "Blue", size: "M" }, channel: CHANNEL_TR }),
    ]);
    expect(sameScope.mapped.map((m) => m.productInput.offerId)).toEqual(["C"]);
    expect(sameScope.invalid).toHaveLength(2);
  });

  it("does not count a skipped offer toward a duplicate", () => {
    const result = mapOffers([
      makeOffer({ variant: { id: "v1", sku: "SAME", status: "archived" } }),
      makeOffer({ variant: { id: "v2", sku: "SAME" } }),
    ]);
    expect(result.invalid).toEqual([]);
    expect(result.mapped).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it("rejects every offer of a product that repeats a non-null color/size combination", () => {
    const offers = [
      makeOffer({ variant: { id: "v1", sku: "A", gtin: GTIN_13, color: "Blue", size: "M" } }),
      makeOffer({ variant: { id: "v2", sku: "B", gtin: GTIN_12, color: "  BLUE ", size: "m" } }),
      makeOffer({ variant: { id: "v3", sku: "C", gtin: GTIN_14, color: "Red", size: "M" } }),
    ];
    const result = mapOffers(offers);
    expect(result.mapped.map((m) => m.productInput.offerId)).toEqual(["C"]);
    expect(result.invalid.map((i) => pairs(i.issues))).toEqual([
      ["variant_not_distinguishable@variant.color"],
      ["variant_not_distinguishable@variant.color"],
    ]);
  });

  it("compares color and size by Unicode composition too (NFC versus NFD)", () => {
    const result = mapOffers([
      makeOffer({ variant: { id: "v1", sku: "A", gtin: GTIN_13, color: "Café", size: "M" } }),
      makeOffer({ variant: { id: "v2", sku: "B", gtin: GTIN_12, color: "Café", size: "M" } }),
    ]);
    expect(result.invalid).toHaveLength(2);
  });

  it("does not flag variants that have neither color nor size", () => {
    const result = mapOffers([
      makeOffer({ variant: { id: "v1", sku: "A", gtin: GTIN_13, color: undefined, size: undefined } }),
      makeOffer({ variant: { id: "v2", sku: "B", gtin: GTIN_12, color: undefined, size: undefined } }),
    ]);
    expect(result.invalid).toEqual([]);
    expect(result.mapped).toHaveLength(2);
  });

  it("does not confuse a color-only variant with a size-only variant", () => {
    const result = mapOffers([
      makeOffer({ variant: { id: "v1", sku: "A", gtin: GTIN_13, color: "M", size: undefined } }),
      makeOffer({ variant: { id: "v2", sku: "B", gtin: GTIN_12, color: undefined, size: "M" } }),
    ]);
    expect(result.invalid).toEqual([]);
  });

  it("rejects every offer of a product that mixes currencies", () => {
    const offers = [
      makeOffer({ variant: { id: "v1", sku: "A", gtin: GTIN_13, color: "Blue", currency: "EUR" } }),
      makeOffer({ variant: { id: "v2", sku: "B", gtin: GTIN_12, color: "Red", currency: "TRY" } }),
      makeOffer({
        product: { id: OTHER_PRODUCT_ID },
        variant: { id: "v3", productId: OTHER_PRODUCT_ID, sku: "C", gtin: GTIN_14, color: "Blue", currency: "TRY" },
      }),
    ];
    const result = mapOffers(offers);
    expect(result.mapped.map((m) => m.productInput.offerId)).toEqual(["C"]);
    expect(result.invalid.map((i) => pairs(i.issues))).toEqual([
      ["mixed_currencies@variant.currency"],
      ["mixed_currencies@variant.currency"],
    ]);
  });

  it("does not count a skipped variant's currency", () => {
    const result = mapOffers([
      makeOffer({ variant: { id: "v1", sku: "A", currency: "EUR" } }),
      makeOffer({ variant: { id: "v2", sku: "B", gtin: GTIN_12, color: "Red", currency: "TRY", status: "draft" } }),
    ]);
    expect(result.invalid).toEqual([]);
  });

  it("keeps an offer's own issues and adds the batch issues", () => {
    const result = mapOffers([
      makeOffer({ variant: { id: "v1", sku: "DUP", gtin: GTIN_13, color: "Blue", priceAmount: 0 } }),
      makeOffer({ variant: { id: "v2", sku: "DUP", gtin: GTIN_12, color: "Red" } }),
    ]);
    expect(result.mapped).toEqual([]);
    const summaries = result.invalid.map((i) => pairs(i.issues));
    expect(summaries).toContainEqual(["duplicate_offer_id@variant.sku", "price_zero_not_allowed@variant.priceAmount"]);
    expect(summaries).toContainEqual(["duplicate_offer_id@variant.sku"]);
  });

  it("returns empty arrays for an empty batch and reports a non-array or unreadable entry safely", () => {
    expect(mapOffers([])).toEqual({ mapped: [], skipped: [], invalid: [] });
    const notArray = mapOffers(null as never);
    expect(notArray.mapped).toEqual([]);
    expect(notArray.invalid.map((i) => i.issues.map((x) => x.code))).toEqual([["unreadable_input"]]);
    const withNull = mapOffers([makeOffer(), null as never]);
    expect(withNull.mapped).toHaveLength(1);
    expect(withNull.invalid).toHaveLength(1);
  });

  it("is deterministic: identical input gives deeply identical output", () => {
    const offers = linenShirtOffers();
    const first = mapOffers(offers);
    const second = mapOffers(offers);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("is independent of input order: every permutation gives the same result", () => {
    const offers = [
      ...linenShirtOffers(),
      makeOffer({ variant: { id: "vd", sku: "LS-DRAFT", status: "draft", gtin: GTIN_8, color: "Green" } }),
    ];
    const expected = mapOffers(offers);
    for (const order of permutations(offers)) {
      expect(mapOffers(order)).toEqual(expected);
    }
  });

  it("is independent of input order for a mixed batch with duplicates, skips, and errors", () => {
    const offers: MerchantOfferInput[] = [
      ...linenShirtOffers(),
      makeOffer({ variant: { id: "d1", sku: "DUP", gtin: GTIN_8, color: "Green", size: "S" } }),
      makeOffer({ variant: { id: "d2", sku: "DUP", gtin: GTIN_13, color: "Pink", size: "S" } }),
      makeOffer({ variant: { id: "s1", sku: "SKIP", status: "archived", gtin: GTIN_8, color: "Grey" } }),
      makeOffer({ variant: { id: "e1", sku: "ERR", gtin: "bad", color: "Teal" } }),
      makeOffer({
        product: { id: OTHER_PRODUCT_ID, title: "Wool Coat", handle: "wool-coat" },
        variant: { id: "w1", productId: OTHER_PRODUCT_ID, sku: "WC-1", gtin: GTIN_14, color: "Camel", size: "L" },
        channel: CHANNEL_DE,
      }),
    ];
    const expected = mapOffers(offers);
    expect(expected.mapped.length).toBeGreaterThan(0);
    expect(expected.skipped).toHaveLength(1);
    expect(expected.invalid.length).toBeGreaterThan(0);
    const expectedJson = JSON.stringify(expected);
    for (let seed = 1; seed <= 60; seed++) {
      const result = mapOffers(shuffled(offers, seed));
      expect(batchSummary(result), `seed ${seed}`).toEqual(batchSummary(expected));
      expect(JSON.stringify(result), `seed ${seed}`).toBe(expectedJson);
    }
  });

  it("orders results with identical ids by their content, so input order never matters", () => {
    const offers: MerchantOfferInput[] = [
      makeOffer({ variant: { id: "vx", sku: "A B" } }),
      makeOffer({ variant: { id: "vx", sku: "C D" }, product: { title: "" } }),
      makeOffer({ variant: { id: "vx", sku: "E F" }, product: { status: "draft" } }),
      makeOffer({ variant: { id: "vx", sku: "G H" }, product: { status: "archived" } }),
    ];
    const expected = mapOffers(offers);
    expect(expected.invalid).toHaveLength(2);
    expect(expected.skipped.map((s) => s.reason)).toEqual(["product_archived", "product_draft"]);
    for (const order of permutations(offers)) {
      expect(mapOffers(order)).toEqual(expected);
    }
  });

  it("does not mutate the input array or its records", () => {
    const offers = deepFreeze(linenShirtOffers());
    expect(() => mapOffers(offers)).not.toThrow();
  });
});

describe("purity: no network, database, clock, randomness, or locale dependence", () => {
  const sourceOf = (file: string) =>
    readFileSync(new URL(file, import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");

  it("has no I/O, network, database, credential, or proposal code in its sources", () => {
    for (const file of ["./mapper.ts", "./types.ts", "./errors.ts"]) {
      const source = sourceOf(file);
      for (const banned of [
        /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /\brequire\s*\(/, /import\s*\(/, /from\s+["']node:/,
        /\bprocess\b/, /\bhttps?\.request\b/, /googleapis/i, /axios/i, /oauth/i, /credential/i, /\bsecret\b/i,
        /prisma/i, /@\/lib\/db/, /@\/lib\/proposals/, /applyProposal/, /createProposal/, /\.env\b/,
        /Date\.now/, /new Date/, /Math\.random/, /toLocale/, /Intl\./, /localeCompare/,
      ]) {
        expect(source, `${file} ${banned}`).not.toMatch(banned);
      }
    }
  });

  it("imports only sibling utilities and canonical types", () => {
    const imports = readFileSync(new URL("./mapper.ts", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => /\bfrom\s+"/.test(line));
    for (const line of imports) {
      expect(line).toMatch(/from\s+"(\.\/(errors|gtin|identifiers|money|text|types|urls)|@\/lib\/schema\/(product|variant))"/);
    }
    expect(imports.length).toBeGreaterThan(0);
  });

  it("gives the same result when the clock, randomness, fetch, and locale APIs all throw", () => {
    const offers = linenShirtOffers();
    const baseline = JSON.stringify(mapOffers(offers));
    vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Math.random used"); });
    vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Date.now used"); });
    vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => { throw new Error("localeCompare used"); });
    vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(() => { throw new Error("toLocaleLowerCase used"); });
    vi.spyOn(String.prototype, "toLocaleUpperCase").mockImplementation(() => { throw new Error("toLocaleUpperCase used"); });
    vi.stubGlobal("fetch", () => { throw new Error("fetch used"); });
    expect(JSON.stringify(mapOffers(offers))).toBe(baseline);
    expect(mapOffer(makeOffer({ variant: { availability: "preorder", availabilityDate: PREORDER_DATE } })).status).toBe("mapped");
  });

  it("does not depend on the time zone", () => {
    const original = process.env.TZ;
    try {
      const results = ["UTC", "Pacific/Kiritimati", "America/Los_Angeles", "Europe/Istanbul"].map((tz) => {
        process.env.TZ = tz;
        return attributesOf(makeOffer({ variant: { availability: "preorder", availabilityDate: PREORDER_DATE } })).availabilityDate;
      });
      expect(new Set(results)).toEqual(new Set(["2026-11-01T00:00:00.000Z"]));
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("supplies its own link, never one derived from the sku or handle", () => {
    expect(linkFor("LS-BLU-M")).toBe("https://shop.example.com/products/linen-shirt?variant=LS-BLU-M");
    expect(attributesOf(makeOffer({ link: "https://elsewhere.example.com/x" })).link).toBe("https://elsewhere.example.com/x");
  });
});
