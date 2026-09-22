// Google Merchant payload mapper (Slice 2): canonical Product + Variant records
// -> a Merchant API v1 `ProductInput` preview.
//
// Pure and deterministic: no network, database, clock, randomness, or locale
// dependence, and nothing is mutated. It reads only its argument, and it never
// throws for bad data: every problem becomes a structured issue with a static
// message that never contains a product value, description, or URL.
//
// Identity (ADR 0003 D4): offerId is Variant.sku, itemGroupId is Product.id
// verbatim, and the identifier is contentLanguage~feedLabel~offerId. The link
// is supplied by the caller (storefront context) and is never derived here.
//
// Each offer yields exactly one of three results:
//   - mapped:  an active Product and Variant that mapped cleanly (with any warnings)
//   - skipped: a draft or archived record, intentionally not published (not an error)
//   - invalid: an active offer with at least one error
//
// Batch mapping adds cross-offer rules (duplicate offerId, duplicate
// color/size, mixed currencies). Every offer involved in such a conflict is
// rejected, so the outcome never depends on input order, and the output is
// sorted so it is identical for any ordering of the same input.

import type { ProductRecord } from "@/lib/schema/product";
import type { VariantRecord } from "@/lib/schema/variant";
import { createIssue, hasErrors, issueFromFailure, type MerchantIssue } from "./errors";
import { validateGtin } from "./gtin";
import {
  buildProductInputId,
  validateContentLanguage,
  validateFeedLabel,
  validateOfferId,
} from "./identifiers";
import { minorUnitsToMicros, validateCurrency } from "./money";
import {
  DESCRIPTION_MAX_CODE_POINTS,
  TITLE_MAX_CODE_POINTS,
  countCodePoints,
  normalizeBoundedText,
  normalizeText,
} from "./text";
import type {
  BatchMapResult,
  InvalidOffer,
  MapOfferResult,
  MappedOffer,
  MerchantAgeGroup,
  MerchantAvailability,
  MerchantCondition,
  MerchantGender,
  MerchantPrice,
  MerchantProductAttributes,
  MerchantSizeSystem,
  MerchantSizeType,
  SkipReason,
  SkippedOffer,
} from "./types";
import { validateHttpUrl } from "./urls";

// ---------------------------------------------------------------------------
// Explicit mapping tables: canonical (lowercase) -> Merchant API
// ---------------------------------------------------------------------------

type Availability = VariantRecord["availability"];
type Condition = ProductRecord["condition"];
type Gender = NonNullable<ProductRecord["gender"]>;
type AgeGroup = NonNullable<ProductRecord["ageGroup"]>;
type SizeType = ProductRecord["sizeTypes"][number];

export const AVAILABILITY_MAP: Readonly<Record<Availability, MerchantAvailability>> = {
  in_stock: "IN_STOCK",
  out_of_stock: "OUT_OF_STOCK",
  preorder: "PREORDER",
  backorder: "BACKORDER",
};

export const CONDITION_MAP: Readonly<Record<Condition, MerchantCondition>> = {
  new: "NEW",
  used: "USED",
  refurbished: "REFURBISHED",
};

export const GENDER_MAP: Readonly<Record<Gender, MerchantGender>> = {
  male: "MALE",
  female: "FEMALE",
  unisex: "UNISEX",
};

export const AGE_GROUP_MAP: Readonly<Record<AgeGroup, MerchantAgeGroup>> = {
  newborn: "NEWBORN",
  infant: "INFANT",
  toddler: "TODDLER",
  child: "KIDS",
  adult: "ADULT",
};

export const SIZE_TYPE_MAP: Readonly<Record<SizeType, MerchantSizeType>> = {
  regular: "REGULAR",
  petite: "PETITE",
  plus: "PLUS",
  tall: "TALL",
  maternity: "MATERNITY",
};

// The canonical size system is an open lowercase token; only these have a
// Merchant equivalent. Anything else is left out with a warning.
export const SIZE_SYSTEM_MAP: Readonly<Record<string, MerchantSizeSystem>> = {
  us: "US",
  uk: "UK",
  eu: "EU",
  de: "DE",
  fr: "FR",
  jp: "JP",
  cn: "CN",
  it: "IT",
  br: "BR",
  mx: "MEX",
  au: "AU",
};

// ---------------------------------------------------------------------------
// Limits (Merchant API v1 and the product data specification)
// ---------------------------------------------------------------------------

export const VARIANT_TITLE_SEPARATOR = " - ";
export const MAX_ADDITIONAL_IMAGES = 10;
export const MAX_SIZE_TYPES = 2;
export const FEED_LABEL_MAX_LENGTH = 20;

export const ATTRIBUTE_MAX_CODE_POINTS = {
  brand: 70,
  mpn: 70,
  color: 100,
  size: 100,
  pattern: 100,
  material: 200,
} as const;

const ITEM_GROUP_ID_MAX_CODE_POINTS = 50;
const ID_MAX_CODE_POINTS = 100;
const UNUSABLE_ID_CHARACTER = /[\p{Cc}\p{Cs}]/u;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lookup<T extends string>(table: Readonly<Record<string, T>>, key: unknown): T | undefined {
  return typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;
}

// An identifier we are willing to carry in a result: bounded, and free of
// control characters.
function usableId(value: unknown, maxCodePoints: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxCodePoints * 2 &&
    countCodePoints(value) <= maxCodePoints &&
    !UNUSABLE_ID_CHARACTER.test(value)
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type TextLimitCode = "title_too_long" | "description_too_long" | "attribute_too_long";

// Normalizes optional or required text and enforces a code-point limit without
// truncating. Problems are pushed as issues; the (possibly undefined) value is returned.
function readText(
  value: unknown,
  path: string,
  max: number,
  tooLong: TextLimitCode,
  required: boolean,
  offerId: unknown,
  issues: MerchantIssue[],
): string | undefined {
  if (value === undefined) {
    if (required) issues.push(createIssue("missing_required_field", path, offerId));
    return undefined;
  }
  const result = normalizeBoundedText(value, max);
  if (result.ok) return result.value;
  const code = result.code;
  if (code === "text_too_long") {
    issues.push(createIssue(tooLong, path, offerId));
  } else {
    issues.push(issueFromFailure({ code, message: result.message }, path, offerId));
  }
  return undefined;
}

// Optional attributes are omitted, not set to undefined.
function present<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

function unreadable(): InvalidOffer {
  return { status: "invalid", issues: [createIssue("unreadable_input", "input")] };
}

// ---------------------------------------------------------------------------
// One offer
// ---------------------------------------------------------------------------

// What batch rules need to know about an offer, read defensively.
interface OfferFacts {
  readonly sku: unknown;
  // contentLanguage~feedLabel: offers in different feed scopes are independent
  // products in Merchant, so the color/size and currency rules apply per scope.
  readonly scope?: string;
  readonly productInputId?: string;
  readonly productId?: string;
  readonly variantId?: string;
  // JSON of the normalized [color, size]; absent when neither is set.
  readonly attributeKey?: string;
  readonly currency?: string;
}

interface Evaluated {
  readonly result: MapOfferResult;
  readonly facts?: OfferFacts;
}

function comparable(value: unknown): string | null {
  if (value === undefined) return null;
  const normalized = normalizeText(value);
  return normalized.ok && normalized.value.length > 0 ? normalized.value.toLowerCase() : null;
}

function readFacts(product: Record<string, unknown>, variant: Record<string, unknown>, channel: Record<string, unknown>): OfferFacts {
  const idResult = buildProductInputId({
    contentLanguage: channel.contentLanguage,
    feedLabel: channel.feedLabel,
    offerId: variant.sku,
  });
  const feedLabel = channel.feedLabel;
  const feedLabelFits = typeof feedLabel === "string" && feedLabel.length <= FEED_LABEL_MAX_LENGTH;
  const color = comparable(variant.color);
  const size = comparable(variant.size);
  const contentLanguage = channel.contentLanguage;
  return {
    sku: variant.sku,
    ...(typeof contentLanguage === "string" && typeof feedLabel === "string"
      ? { scope: `${contentLanguage}~${feedLabel}` }
      : {}),
    ...(idResult.ok && feedLabelFits ? { productInputId: idResult.value } : {}),
    ...(usableId(product.id, ITEM_GROUP_ID_MAX_CODE_POINTS) ? { productId: product.id } : {}),
    ...(usableId(variant.id, ID_MAX_CODE_POINTS) ? { variantId: variant.id } : {}),
    ...(color !== null || size !== null ? { attributeKey: JSON.stringify([color, size]) } : {}),
    ...(typeof variant.currency === "string" ? { currency: variant.currency } : {}),
  };
}

function invalidFrom(issues: readonly MerchantIssue[], facts: OfferFacts): InvalidOffer {
  return {
    status: "invalid",
    issues,
    ...present("productInputId", facts.productInputId),
    ...present("productId", facts.productId),
    ...present("variantId", facts.variantId),
  };
}

const LIFECYCLE = new Set(["draft", "active", "archived"]);

function evaluate(input: unknown): Evaluated {
  if (!isRecord(input)) return { result: unreadable() };
  const product = input.product;
  const variant = input.variant;
  const channel = input.channel;
  if (!isRecord(product) || !isRecord(variant) || !isRecord(channel)) return { result: unreadable() };

  const facts = readFacts(product, variant, channel);
  const offerId = variant.sku;

  // 1. Structure: stable ids, pairing, and lifecycle values.
  const structural: MerchantIssue[] = [];
  const productId = product.id;
  const variantProductId = variant.productId;

  if (!usableId(variant.id, ID_MAX_CODE_POINTS)) {
    structural.push(createIssue("missing_required_field", "variant.id", offerId));
  }
  if (typeof productId !== "string" || productId.length === 0) {
    structural.push(createIssue("missing_required_field", "product.id", offerId));
  } else if (!usableId(productId, ITEM_GROUP_ID_MAX_CODE_POINTS)) {
    structural.push(createIssue("invalid_item_group_id", "product.id", offerId));
  }
  if (typeof variantProductId !== "string" || variantProductId.length === 0) {
    structural.push(createIssue("missing_required_field", "variant.productId", offerId));
  } else if (typeof productId === "string" && productId.length > 0 && variantProductId !== productId) {
    structural.push(createIssue("variant_product_mismatch", "variant.productId", offerId));
  }
  if (!LIFECYCLE.has(product.status as string)) {
    structural.push(createIssue("invalid_enum_value", "product.status", offerId));
  }
  if (!LIFECYCLE.has(variant.status as string)) {
    structural.push(createIssue("invalid_enum_value", "variant.status", offerId));
  }
  if (structural.length > 0) return { result: invalidFrom(structural, facts), facts };

  // 2. Lifecycle: draft and archived records are skipped, not invalid, and
  // their content is not validated (a draft may be incomplete).
  const skip = skipReason(product.status as string, variant.status as string);
  if (skip !== undefined) {
    const skipped: SkippedOffer = {
      status: "skipped",
      reason: skip,
      productId: productId as string,
      variantId: variant.id as string,
    };
    return { result: skipped };
  }

  // 3. Content of an active offer.
  return { result: mapContent(product, variant, channel, input.link, facts), facts };
}

function skipReason(productStatus: string, variantStatus: string): SkipReason | undefined {
  if (productStatus === "draft") return "product_draft";
  if (productStatus === "archived") return "product_archived";
  if (variantStatus === "draft") return "variant_draft";
  if (variantStatus === "archived") return "variant_archived";
  return undefined;
}

function mapContent(
  product: Record<string, unknown>,
  variant: Record<string, unknown>,
  channel: Record<string, unknown>,
  linkInput: unknown,
  facts: OfferFacts,
): MapOfferResult {
  const issues: MerchantIssue[] = [];
  const offerId = variant.sku;

  // Identifiers.
  const contentLanguage = validateContentLanguage(channel.contentLanguage);
  if (!contentLanguage.ok) issues.push(issueFromFailure(contentLanguage, "channel.contentLanguage", offerId));
  const feedLabel = validateFeedLabel(channel.feedLabel);
  if (!feedLabel.ok) {
    issues.push(issueFromFailure(feedLabel, "channel.feedLabel", offerId));
  } else if (feedLabel.value.length > FEED_LABEL_MAX_LENGTH) {
    issues.push(createIssue("feed_label_too_long", "channel.feedLabel", offerId));
  }
  const sku = validateOfferId(variant.sku);
  if (!sku.ok) issues.push(issueFromFailure(sku, "variant.sku", offerId));

  // Link: supplied by the storefront, validated, never derived.
  const link = validateHttpUrl(linkInput);
  if (!link.ok) issues.push(issueFromFailure(link, "link", offerId));

  // Title (derived), description.
  const title = mapTitle(product, offerId, issues);
  const color = readText(variant.color, "variant.color", ATTRIBUTE_MAX_CODE_POINTS.color, "attribute_too_long", false, offerId, issues);
  const size = readText(variant.size, "variant.size", ATTRIBUTE_MAX_CODE_POINTS.size, "attribute_too_long", false, offerId, issues);
  const description = readText(product.description, "product.description", DESCRIPTION_MAX_CODE_POINTS, "description_too_long", true, offerId, issues);

  const titleText = title === undefined ? undefined : deriveTitle(title, color, size, offerId, issues);

  // Images.
  const images = mapImages(product, variant, offerId, issues);

  // Prices.
  const prices = mapPrices(variant, offerId, issues);

  // Availability, condition.
  const availability = lookup(AVAILABILITY_MAP, variant.availability);
  if (availability === undefined) issues.push(createIssue("invalid_enum_value", "variant.availability", offerId));
  const availabilityDate = mapAvailabilityDate(variant, availability, offerId, issues);
  const condition = lookup(CONDITION_MAP, product.condition);
  if (condition === undefined) issues.push(createIssue("invalid_enum_value", "product.condition", offerId));

  // GTIN, MPN, brand.
  const brand = readText(product.brand, "product.brand", ATTRIBUTE_MAX_CODE_POINTS.brand, "attribute_too_long", false, offerId, issues);
  const mpn = readText(variant.mpn, "variant.mpn", ATTRIBUTE_MAX_CODE_POINTS.mpn, "attribute_too_long", false, offerId, issues);
  let gtin: string | undefined;
  if (variant.gtin !== undefined) {
    const validated = validateGtin(variant.gtin);
    if (validated.ok) gtin = validated.value;
    else issues.push(issueFromFailure(validated, "variant.gtin", offerId));
  }
  if (variant.gtin === undefined && variant.mpn === undefined) {
    issues.push(createIssue("missing_identifier", "variant.gtin", offerId));
  }
  if (variant.mpn !== undefined && product.brand === undefined) {
    issues.push(createIssue("mpn_requires_brand", "variant.mpn", offerId));
  }
  if (gtin !== undefined && product.brand === undefined) {
    issues.push(createIssue("gtin_without_brand", "variant.gtin", offerId));
  }

  // Apparel and other optional attributes.
  const material = readText(product.material, "product.material", ATTRIBUTE_MAX_CODE_POINTS.material, "attribute_too_long", false, offerId, issues);
  const pattern = readText(product.pattern, "product.pattern", ATTRIBUTE_MAX_CODE_POINTS.pattern, "attribute_too_long", false, offerId, issues);
  const gender = mapEnum(GENDER_MAP, product.gender, "product.gender", offerId, issues);
  const ageGroup = mapEnum(AGE_GROUP_MAP, product.ageGroup, "product.ageGroup", offerId, issues);
  const sizeSystem = mapSizeSystem(product.sizeSystem, offerId, issues);
  const sizeTypes = mapSizeTypes(product.sizeTypes, offerId, issues);

  // itemGroupId is Product.id verbatim (its validity was checked with the ids).
  const itemGroupId = product.id as string;

  const complete =
    contentLanguage.ok && feedLabel.ok && sku.ok && link.ok && titleText !== undefined && description !== undefined &&
    images.imageLink !== undefined && prices !== undefined && availability !== undefined && condition !== undefined;

  if (!complete || hasErrors(issues)) {
    if (!hasErrors(issues)) issues.push(createIssue("unreadable_input", "input", offerId));
    return invalidFrom(issues, facts);
  }

  const attributes: MerchantProductAttributes = {
    title: titleText,
    description,
    link: link.value,
    imageLink: images.imageLink,
    ...present("additionalImageLinks", images.additional),
    price: prices.price,
    ...present("salePrice", prices.salePrice),
    availability,
    ...present("availabilityDate", availabilityDate),
    condition,
    ...present("gtins", gtin === undefined ? undefined : [gtin]),
    ...present("mpn", mpn),
    ...present("brand", brand),
    itemGroupId,
    ...present("color", color),
    ...present("size", size),
    ...present("material", material),
    ...present("pattern", pattern),
    ...present("gender", gender),
    ...present("ageGroup", ageGroup),
    ...present("sizeSystem", sizeSystem),
    ...present("sizeTypes", sizeTypes),
  };

  const mapped: MappedOffer = {
    status: "mapped",
    productInputId: `${contentLanguage.value}~${feedLabel.value}~${sku.value}`,
    productInput: {
      offerId: sku.value,
      contentLanguage: contentLanguage.value,
      feedLabel: feedLabel.value,
      productAttributes: attributes,
    },
    warnings: issues.filter((issue) => issue.severity === "warning"),
    productId: itemGroupId,
    variantId: variant.id as string,
  };
  return mapped;
}

// The base product title, normalized (NFC + trim); the variant title is built
// from it in deriveTitle. Product.title itself is never modified.
function mapTitle(
  product: Record<string, unknown>,
  offerId: unknown,
  issues: MerchantIssue[],
): string | undefined {
  if (product.title === undefined) {
    issues.push(createIssue("missing_required_field", "product.title", offerId));
    return undefined;
  }
  const result = normalizeBoundedText(product.title, Number.MAX_SAFE_INTEGER);
  if (result.ok) return result.value;
  const code = result.code;
  if (code === "text_too_long") {
    issues.push(createIssue("title_too_long", "product.title", offerId));
  } else {
    issues.push(issueFromFailure({ code, message: result.message }, "product.title", offerId));
  }
  return undefined;
}

// "<title> - <color> - <size>", using the variant's own attributes only, so an
// offer's title never depends on which siblings exist. Rejected, never truncated.
function deriveTitle(
  base: string,
  color: string | undefined,
  size: string | undefined,
  offerId: unknown,
  issues: MerchantIssue[],
): string | undefined {
  const parts = [base];
  if (color !== undefined) parts.push(color);
  if (size !== undefined) parts.push(size);
  const derived = parts.join(VARIANT_TITLE_SEPARATOR);
  if (countCodePoints(derived) > TITLE_MAX_CODE_POINTS) {
    issues.push(createIssue("title_too_long", "product.title", offerId));
    return undefined;
  }
  return derived;
}

interface MappedImages {
  readonly imageLink?: string;
  readonly additional?: readonly string[];
}

// Variant image first, otherwise Product.images[0]. The remaining product
// images keep their order; an image equal to the primary is not repeated.
function mapImages(
  product: Record<string, unknown>,
  variant: Record<string, unknown>,
  offerId: unknown,
  issues: MerchantIssue[],
): MappedImages {
  const shared = product.images;
  const validShared: { readonly index: number; readonly url: string }[] = [];
  let hasSharedImages = false;

  if (Array.isArray(shared)) {
    hasSharedImages = shared.length > 0;
    shared.forEach((image: unknown, index: number) => {
      const result = validateHttpUrl(image);
      if (result.ok) validShared.push({ index, url: result.value });
      else issues.push(issueFromFailure(result, `product.images[${index}]`, offerId));
    });
  } else if (shared !== undefined) {
    issues.push(createIssue("missing_required_field", "product.images", offerId));
  }

  let primary: string | undefined;
  if (variant.imageUrl !== undefined) {
    const result = validateHttpUrl(variant.imageUrl);
    if (result.ok) {
      primary = result.value;
    } else {
      issues.push(issueFromFailure(result, "variant.imageUrl", offerId));
    }
  } else if (!hasSharedImages) {
    issues.push(createIssue("missing_image", "product.images", offerId));
  } else {
    primary = validShared.find((entry) => entry.index === 0)?.url;
  }

  // Every valid product image except the primary, in order. When the primary is
  // Product.images[0] it is excluded as an exact duplicate of itself.
  const candidates = validShared.map((entry) => entry.url).filter((url) => url !== primary);

  if (candidates.length > MAX_ADDITIONAL_IMAGES) {
    issues.push(createIssue("too_many_images", "product.images", offerId));
  }

  return {
    ...present("imageLink", primary),
    ...(candidates.length > 0 ? { additional: candidates } : {}),
  };
}

interface MappedPrices {
  readonly price: MerchantPrice;
  readonly salePrice?: MerchantPrice;
}

// With a compare-at price (the regular price, valid only when greater), price =
// compareAt and salePrice = priceAmount; otherwise only price. Exact BigInt.
function mapPrices(
  variant: Record<string, unknown>,
  offerId: unknown,
  issues: MerchantIssue[],
): MappedPrices | undefined {
  const currency = validateCurrency(variant.currency);
  if (!currency.ok) {
    issues.push(issueFromFailure(currency, "variant.currency", offerId));
    return undefined;
  }

  const current = minorUnitsToMicros(variant.priceAmount, currency.value);
  if (!current.ok) issues.push(issueFromFailure(current, "variant.priceAmount", offerId));

  const compareAt = variant.compareAtPriceAmount;
  if (compareAt === undefined) {
    return current.ok
      ? { price: { amountMicros: current.value, currencyCode: currency.value } }
      : undefined;
  }

  if (typeof compareAt !== "number" || typeof variant.priceAmount !== "number" || !(compareAt > variant.priceAmount)) {
    issues.push(createIssue("invalid_compare_at_price", "variant.compareAtPriceAmount", offerId));
    return undefined;
  }
  const regular = minorUnitsToMicros(compareAt, currency.value);
  if (!regular.ok) issues.push(issueFromFailure(regular, "variant.compareAtPriceAmount", offerId));
  if (!current.ok || !regular.ok) return undefined;
  return {
    price: { amountMicros: regular.value, currencyCode: currency.value },
    salePrice: { amountMicros: current.value, currencyCode: currency.value },
  };
}

// Required for preorder and backorder (ADR 0003 D13); ignored with a warning
// otherwise. Formatted as a UTC ISO 8601 timestamp, independent of time zone.
function mapAvailabilityDate(
  variant: Record<string, unknown>,
  availability: MerchantAvailability | undefined,
  offerId: unknown,
  issues: MerchantIssue[],
): string | undefined {
  if (availability === undefined) return undefined;
  const date = variant.availabilityDate;
  if (availability === "PREORDER" || availability === "BACKORDER") {
    if (date === undefined) {
      issues.push(createIssue("missing_availability_date", "variant.availabilityDate", offerId));
      return undefined;
    }
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
    issues.push(createIssue("invalid_availability_date", "variant.availabilityDate", offerId));
    return undefined;
  }
  if (date !== undefined) {
    issues.push(createIssue("availability_date_ignored", "variant.availabilityDate", offerId));
  }
  return undefined;
}

function mapEnum<T extends string>(
  table: Readonly<Record<string, T>>,
  value: unknown,
  path: string,
  offerId: unknown,
  issues: MerchantIssue[],
): T | undefined {
  if (value === undefined) return undefined;
  const mapped = lookup(table, value);
  if (mapped === undefined) issues.push(createIssue("invalid_enum_value", path, offerId));
  return mapped;
}

function mapSizeSystem(
  value: unknown,
  offerId: unknown,
  issues: MerchantIssue[],
): MerchantSizeSystem | undefined {
  if (value === undefined) return undefined;
  const mapped = lookup(SIZE_SYSTEM_MAP, value);
  if (mapped === undefined) issues.push(createIssue("unmapped_attribute", "product.sizeSystem", offerId));
  return mapped;
}

function mapSizeTypes(
  value: unknown,
  offerId: unknown,
  issues: MerchantIssue[],
): readonly MerchantSizeType[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push(createIssue("invalid_enum_value", "product.sizeTypes", offerId));
    return undefined;
  }
  const mapped: MerchantSizeType[] = [];
  let allKnown = true;
  for (const entry of value as unknown[]) {
    const known = lookup(SIZE_TYPE_MAP, entry);
    if (known === undefined) allKnown = false;
    else mapped.push(known);
  }
  if (!allKnown) {
    issues.push(createIssue("invalid_enum_value", "product.sizeTypes", offerId));
    return undefined;
  }
  if (mapped.length > MAX_SIZE_TYPES) {
    issues.push(createIssue("too_many_size_types", "product.sizeTypes", offerId));
    return undefined;
  }
  return mapped.length > 0 ? mapped : undefined;
}

// Maps one offer. Never throws for bad data.
export function mapOffer(input: unknown): MapOfferResult {
  return evaluateSafely(input).result;
}

function evaluateSafely(input: unknown): Evaluated {
  try {
    return evaluate(input);
  } catch {
    return { result: unreadable() };
  }
}

// ---------------------------------------------------------------------------
// A batch of offers
// ---------------------------------------------------------------------------

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | undefined): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    const key = keyOf(item);
    if (key === undefined) return;
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [index]);
    else members.push(index);
  });
  return groups;
}

// Maps a batch. Offers that conflict with one another (same offerId in one
// feed scope, same color/size within a product, mixed currencies within a
// product) are all rejected. Output is sorted, so it does not depend on the
// order of the input.
export function mapOffers(inputs: readonly unknown[]): BatchMapResult {
  if (!Array.isArray(inputs)) return { mapped: [], skipped: [], invalid: [unreadable()] };

  const evaluated: Evaluated[] = (inputs as unknown[]).map(evaluateSafely);
  const active = evaluated.filter((entry) => entry.result.status !== "skipped" && entry.facts !== undefined);

  const extra = new Map<Evaluated, MerchantIssue[]>();
  const addIssue = (entry: Evaluated, issue: MerchantIssue) => {
    const list = extra.get(entry);
    if (list === undefined) extra.set(entry, [issue]);
    else list.push(issue);
  };
  const factsOf = (entry: Evaluated): OfferFacts => entry.facts as OfferFacts;

  // Rule 1: the same offerId within one contentLanguage/feedLabel scope.
  for (const members of groupBy(active, (entry) => factsOf(entry).productInputId).values()) {
    if (members.length > 1) {
      for (const index of members) {
        const entry = active[index] as Evaluated;
        addIssue(entry, createIssue("duplicate_offer_id", "variant.sku", factsOf(entry).sku));
      }
    }
  }

  // Rule 2: the same non-null color/size combination within one product and
  // feed scope.
  const attributeKey = (entry: Evaluated): string | undefined => {
    const facts = factsOf(entry);
    return facts.scope === undefined || facts.productId === undefined || facts.attributeKey === undefined
      ? undefined
      : `${facts.scope}\u0000${facts.productId}\u0000${facts.attributeKey}`;
  };
  for (const members of groupBy(active, attributeKey).values()) {
    if (members.length > 1) {
      for (const index of members) {
        const entry = active[index] as Evaluated;
        addIssue(entry, createIssue("variant_not_distinguishable", "variant.color", factsOf(entry).sku));
      }
    }
  }

  // Rule 3: mixed currencies within one product and feed scope (a product may
  // be sold in different currencies in different markets).
  const byProduct = groupBy(active, (entry) => {
    const facts = factsOf(entry);
    return facts.currency === undefined || facts.scope === undefined || facts.productId === undefined
      ? undefined
      : `${facts.scope}\u0000${facts.productId}`;
  });
  for (const members of byProduct.values()) {
    const currencies = new Set(members.map((index) => factsOf(active[index] as Evaluated).currency));
    if (currencies.size > 1) {
      for (const index of members) {
        const entry = active[index] as Evaluated;
        addIssue(entry, createIssue("mixed_currencies", "variant.currency", factsOf(entry).sku));
      }
    }
  }

  const mapped: MappedOffer[] = [];
  const skipped: SkippedOffer[] = [];
  const invalid: InvalidOffer[] = [];

  for (const entry of evaluated) {
    const result = entry.result;
    const conflicts = extra.get(entry) ?? [];
    if (result.status === "skipped") {
      skipped.push(result);
    } else if (result.status === "mapped") {
      if (conflicts.length === 0) {
        mapped.push(result);
      } else {
        invalid.push({
          status: "invalid",
          issues: [...result.warnings, ...conflicts],
          productInputId: result.productInputId,
          productId: result.productId,
          variantId: result.variantId,
        });
      }
    } else {
      invalid.push(conflicts.length === 0 ? result : { ...result, issues: [...result.issues, ...conflicts] });
    }
  }

  mapped.sort(
    (a, b) => compareStrings(a.productInputId, b.productInputId) || compareStrings(a.variantId, b.variantId),
  );
  // Ties on every id are broken by content, so the order never depends on the
  // order of the input.
  skipped.sort(
    (a, b) =>
      compareStrings(a.productId, b.productId) ||
      compareStrings(a.variantId, b.variantId) ||
      compareStrings(a.reason, b.reason),
  );
  invalid.sort(
    (a, b) =>
      compareStrings(a.productInputId ?? "", b.productInputId ?? "") ||
      compareStrings(a.productId ?? "", b.productId ?? "") ||
      compareStrings(a.variantId ?? "", b.variantId ?? "") ||
      compareStrings(JSON.stringify(a.issues), JSON.stringify(b.issues)),
  );

  return { mapped, skipped, invalid };
}
