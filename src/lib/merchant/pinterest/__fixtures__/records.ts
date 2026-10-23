import type { ProductRecord } from "@/lib/schema/product";
import type { VariantRecord } from "@/lib/schema/variant";

export function offer(product: Partial<ProductRecord> = {}, variant: Partial<VariantRecord> = {}, link = "https://shop.example/products/shirt?variant=blue-m") {
  return {
    product: {
      id: "product-1", handle: "linen-shirt", title: "Linen Shirt",
      description: "A relaxed linen shirt.", brand: "ONOE", productType: "Clothing > Shirts",
      condition: "new", material: "linen", pattern: "solid", gender: "unisex", ageGroup: "adult",
      images: ["https://cdn.example/one.jpg", "https://cdn.example/two.jpg"],
      tags: [], attributes: {}, status: "active", sizeSystem: "eu", sizeTypes: ["regular"],
      sourceUpdatedAt: new Date("2026-01-01T00:00:00Z"), ...product,
    } as ProductRecord,
    variant: {
      id: "variant-1", productId: "product-1", sku: "SHIRT-BLUE-M", gtin: "012345678905",
      priceAmount: 2990, currency: "EUR", availability: "in_stock", inventoryQuantity: 2,
      color: "Blue", size: "M", status: "active", sourceUpdatedAt: new Date("2026-01-01T00:00:00Z"),
      ...variant,
    } as VariantRecord,
    link,
  };
}
