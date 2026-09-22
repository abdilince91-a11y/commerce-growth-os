// Typed fixtures for the Google Merchant mapper. Canonical records only: no
// database, network, or Merchant Center account is involved. Used only by tests.
//
// GTINs are real, checksum-valid examples.

import type { ProductRecord } from "@/lib/schema/product";
import type { VariantRecord } from "@/lib/schema/variant";
import type { MerchantChannelConfig, MerchantOfferInput } from "../types";

export const GTIN_8 = "96385074";
export const GTIN_12 = "012345678905";
export const GTIN_13 = "0012345678905";
export const GTIN_14 = "10012345678902";

export const CHANNEL_TR: MerchantChannelConfig = { contentLanguage: "tr", feedLabel: "TR" };
export const CHANNEL_DE: MerchantChannelConfig = { contentLanguage: "de", feedLabel: "DE" };

export const PRODUCT_ID = "ckprodlinenshirt00000001";
export const OTHER_PRODUCT_ID = "ckprodwoolcoat000000001";

export const SOURCE_UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");

export const IMAGE_1 = "https://cdn.example.com/images/linen-shirt-1.jpg";
export const IMAGE_2 = "https://cdn.example.com/images/linen-shirt-2.jpg";
export const IMAGE_3 = "https://cdn.example.com/images/linen-shirt-3.jpg";
export const VARIANT_IMAGE = "https://cdn.example.com/images/linen-shirt-blue-m.jpg";

// The storefront supplies the link; the mapper never builds it. A SKU is
// URL-encoded here so that even an unusual test SKU yields a well-formed link.
export function linkFor(sku: string): string {
  return `https://shop.example.com/products/linen-shirt?variant=${encodeURIComponent(sku)}`;
}

export function makeProduct(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: PRODUCT_ID,
    handle: "linen-shirt",
    title: "Linen Shirt",
    description: "A relaxed linen shirt for warm days.",
    brand: "ONOE",
    productType: "shirts",
    material: "linen",
    condition: "new",
    images: [IMAGE_1, IMAGE_2, IMAGE_3],
    tags: [],
    attributes: {},
    status: "active",
    gender: "unisex",
    ageGroup: "adult",
    pattern: "solid",
    sizeSystem: "eu",
    sizeTypes: ["regular"],
    sourceUpdatedAt: SOURCE_UPDATED_AT,
    ...overrides,
  };
}

export function makeVariant(overrides: Partial<VariantRecord> = {}): VariantRecord {
  return {
    id: "ckvariantlsbluem0000001",
    productId: PRODUCT_ID,
    sku: "LS-BLU-M",
    gtin: GTIN_13,
    priceAmount: 4990,
    currency: "EUR",
    availability: "in_stock",
    inventoryQuantity: 12,
    color: "Blue",
    size: "M",
    status: "active",
    sourceUpdatedAt: SOURCE_UPDATED_AT,
    ...overrides,
  };
}

export function makeOffer(overrides: {
  product?: Partial<ProductRecord>;
  variant?: Partial<VariantRecord>;
  channel?: MerchantChannelConfig;
  link?: string;
} = {}): MerchantOfferInput {
  const variant = makeVariant(overrides.variant);
  return {
    product: makeProduct(overrides.product),
    variant,
    channel: overrides.channel ?? CHANNEL_TR,
    link: overrides.link ?? linkFor(variant.sku),
  };
}

// A product family: three distinguishable variants of the linen shirt.
export const LINEN_SHIRT_PRODUCT: ProductRecord = makeProduct();

export const LINEN_SHIRT_VARIANTS: readonly VariantRecord[] = [
  makeVariant({ id: "ckvariantlsbluem0000001", sku: "LS-BLU-M", gtin: GTIN_13, color: "Blue", size: "M" }),
  makeVariant({ id: "ckvariantlsbluel0000002", sku: "LS-BLU-L", gtin: GTIN_12, color: "Blue", size: "L" }),
  makeVariant({ id: "ckvariantlsredm00000003", sku: "LS-RED-M", gtin: GTIN_14, color: "Red", size: "M" }),
];

export function linenShirtOffers(channel: MerchantChannelConfig = CHANNEL_TR): MerchantOfferInput[] {
  return LINEN_SHIRT_VARIANTS.map((variant) => ({
    product: LINEN_SHIRT_PRODUCT,
    variant,
    channel,
    link: linkFor(variant.sku),
  }));
}
