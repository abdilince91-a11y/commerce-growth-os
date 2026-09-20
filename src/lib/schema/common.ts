import { z } from "zod";

// Shared canonical building blocks. See
// docs/decisions/0003-canonical-product-variant.md.
//
// Canonical enum values are lowercase, matching the existing Prisma enums.
// Mapping to any external API spelling belongs at that adapter's boundary.

export const AvailabilitySchema = z.enum([
  "in_stock",
  "out_of_stock",
  "preorder",
  "backorder",
]);

export const LifecycleStatusSchema = z.enum(["draft", "active", "archived"]);

export const ProductConditionSchema = z.enum(["new", "used", "refurbished"]);

// Channel-neutral apparel metadata (deliberately not any platform's spelling).
export const GenderSchema = z.enum(["male", "female", "unisex"]);
export const AgeGroupSchema = z.enum(["newborn", "infant", "toddler", "child", "adult"]);
export const SizeTypeSchema = z.enum(["regular", "petite", "plus", "tall", "maternity"]);

export const IdSchema = z.string().min(1);

export const NonBlankStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "must not be blank" });

// ISO 4217-shaped: exactly three uppercase ASCII letters. Shape only; the
// value is not checked against the ISO list, and no currency enum exists so a
// new currency never needs a migration. Which currencies a given channel
// supports is that channel adapter's allowlist, not a canonical rule.
export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, { message: "must be exactly three uppercase ASCII letters (ISO 4217 shape)" });

export function isHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === ""
  );
}

// z.string().url() alone accepts javascript:, data:, ftp: and URLs with
// embedded credentials, so only absolute http(s) URLs without credentials pass.
export const HttpUrlSchema = z
  .string()
  .max(2048)
  .refine(isHttpUrl, {
    message: "must be an absolute http or https URL without embedded credentials",
  });

// A Date, or a non-empty string that parses to a valid date. It deliberately
// rejects null and numbers: z.coerce.date() alone turns null into the Unix
// epoch, which would silently turn "unknown" into 1970-01-01.
export const DateInputSchema = z
  .union([z.date(), z.string().min(1)])
  .pipe(z.coerce.date());
