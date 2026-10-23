import { z } from "zod";
import { gtinProblem } from "@/lib/schema/gtin";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const FORMULA = /^[\s\p{Cf}]*[=+@-]/u;
const HTML = /<\s*(?:\/?[a-zA-Z]|!)[^>]*>/;
const CONTROLS = /\p{Cc}/u;

export const IdentifierSchema = z.string().refine((value) =>
  value.length > 0 && value.length <= 254 && Array.from(value).length <= 127
  && !/[\s\p{Cc}]/u.test(value) && !LONE_SURROGATE.test(value) && !FORMULA.test(value),
);

function text(max: number, multiline = false) {
  return z.string().refine((value) => !LONE_SURROGATE.test(value))
    .transform((value) => value.normalize("NFC").trim())
    .refine((value) => value.length > 0 && Array.from(value).length <= max
      && !CONTROLS.test(multiline ? value.replace(/[\t\r\n]/g, "") : value) && !FORMULA.test(value) && !HTML.test(value));
}

function url(max: number, image = false) {
  return z.string().refine((value) => {
    if (!value || value.length > max * 2 || Array.from(value).length > max || /[\s\p{Cc}\p{Cs}\\]/u.test(value)) return false;
    if (image && value.includes(",")) return false;
    const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(value)?.[1];
    if (!authority || authority.includes("@")) return false;
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "https:" || parsed.protocol === "http:")
        && parsed.hostname !== "" && parsed.username === "" && parsed.password === "";
    } catch { return false; }
  });
}

export function priceMinor(price: string): bigint {
  const [amount = ""] = price.split(" ");
  const [whole = "", fraction = ""] = amount.split(".");
  return BigInt(whole + fraction);
}

const price = z.string().regex(/^(?:0|[1-9][0-9]{0,7})\.[0-9]{2} (?:EUR|TRY)$/)
  .refine((value) => {
    if (!/^(?:0|[1-9][0-9]{0,7})\.[0-9]{2} (?:EUR|TRY)$/.test(value)) return false;
    const minor = priceMinor(value);
    return minor > 0n && minor <= 2147483647n;
  });

const gtin = z.string().refine((value) => gtinProblem(value) === null
  && !(value.length === 13 && /^9[89]/.test(value))
  && !(value.length === 14 && /^[0-9]9[89]/.test(value)));

export const CatalogItemSchema = z.object({
  id: IdentifierSchema,
  title: text(500),
  description: text(10000, true),
  link: url(511),
  image_link: url(2000, true),
  price,
  availability: z.enum(["in stock", "out of stock", "preorder"]),
  item_group_id: IdentifierSchema,
  condition: z.enum(["new", "used", "refurbished"]),
  sale_price: price.optional(),
  additional_image_link: z.array(url(2000, true)).max(10).optional(),
  brand: text(100).optional(),
  GTIN: gtin.optional(),
  mpn: z.string().regex(/^[A-Za-z0-9]{1,70}$/).optional(),
  color: text(30).optional(),
  size: text(30).optional(),
  material: text(30).optional(),
  pattern: text(30).optional(),
  gender: z.enum(["male", "female", "unisex"]).optional(),
  age_group: z.enum(["newborn", "infant", "toddler", "kids", "adult"]).optional(),
  product_type: text(1000).refine((value) => {
    const parts = value.split(" > ");
    return parts.length <= 5 && parts.every((part) => part.trim().length > 0 && !part.includes(">"));
  }).optional(),
}).strict().superRefine((item, ctx) => {
  const priceShape = /^(?:0|[1-9][0-9]{0,7})\.[0-9]{2} (?:EUR|TRY)$/;
  if (item.sale_price !== undefined && priceShape.test(item.price) && priceShape.test(item.sale_price) && (
    item.price.split(" ")[1] !== item.sale_price.split(" ")[1]
    || priceMinor(item.sale_price) >= priceMinor(item.price)
  )) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sale_price"], message: "Invalid sale price" });
});

export const ITEM_FIELDS = [
  "id", "title", "description", "link", "image_link", "price", "availability", "item_group_id",
  "condition", "sale_price", "additional_image_link", "brand", "GTIN", "mpn", "color", "size",
  "material", "pattern", "gender", "age_group", "product_type",
] as const;
