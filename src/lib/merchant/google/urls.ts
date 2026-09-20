// URL validation for the Google Merchant adapter (Slice 1).
//
// A URL is accepted only if it is an absolute http or https URL with a host
// and no embedded credentials. The original string is returned exactly as
// supplied: it is never canonicalized, re-serialized, or stripped of query
// parameters, so tracking parameters and casing survive.
//
// Parsing is done with the platform URL parser purely to inspect the string;
// nothing is fetched or resolved. To close gaps between what is validated and
// what a parser would actually use, any whitespace, control character,
// backslash, or unpaired surrogate is rejected up front (a parser silently
// removes tabs and newlines and treats a backslash as a slash).
//
// Invalid external input never throws. Failures carry a static message that
// never contains the URL or any part of it.

export type UrlErrorCode = "invalid_url" | "unsafe_url_scheme" | "url_has_credentials";

export interface UrlFailure {
  readonly ok: false;
  readonly code: UrlErrorCode;
  readonly message: string;
}

export type UrlResult = { readonly ok: true; readonly value: string } | UrlFailure;

const MESSAGES: Readonly<Record<UrlErrorCode, string>> = {
  invalid_url: "must be an absolute http or https URL",
  unsafe_url_scheme: "URL scheme must be http or https",
  url_has_credentials: "URL must not contain embedded credentials",
};

function fail(code: UrlErrorCode): UrlFailure {
  return { ok: false, code, message: MESSAGES[code] };
}

const FORBIDDEN_RAW_CHARACTER = /[\s\p{Cc}\p{Cs}\\]/u;

// scheme "://" then the authority, which runs up to the first / ? or #.
const AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/;

export function validateHttpUrl(value: unknown): UrlResult {
  if (typeof value !== "string" || value.length === 0) return fail("invalid_url");
  if (FORBIDDEN_RAW_CHARACTER.test(value)) return fail("invalid_url");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("invalid_url");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return fail("unsafe_url_scheme");

  // "http:example.com" parses as a URL but is not written as scheme://host.
  const match = AUTHORITY.exec(value);
  if (match === null) return fail("invalid_url");
  const authority = match[1] ?? "";
  if (authority.length === 0) return fail("invalid_url");

  // Any "@" in the authority is userinfo, even an empty one ("https://@host").
  if (authority.includes("@") || url.username !== "" || url.password !== "") {
    return fail("url_has_credentials");
  }

  return { ok: true, value };
}
