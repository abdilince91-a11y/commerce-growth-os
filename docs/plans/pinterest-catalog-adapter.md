# Pinterest retail catalog preview — implementation plan

Date: 2026-10-23. Milestone 5 of v0.1. Based on security PR #14 at
fdfeefbf0484aa0afc696b9d451fa8d63eb6663d; publish as a stacked PR targeting that
branch until #14 is merged. No production deployment is part of this work.

## Contract and scope

Pure canonical ProductRecord + VariantRecord -> retail data-source row -> UTF-8
CSV preview, with feed_update proposal snapshots. This is a retail feed format,
not the REST batch API (whose attributes and envelopes differ). No credentials,
network, database, clock, filesystem writes, catalog upload or proposal apply.
Invalid ordinary JSON inputs yield static diagnostics without echoing values.

Official Pinterest retail catalog specification checked 2026-10-23:
https://help.pinterest.com/en/business/article/before-you-get-started-with-catalogs
API format distinction checked against:
https://developer.pinterest.com/docs/work-with-catalogs/modify-items-in-batch/

- Required feed columns: id, title, description, link, image_link, price,
  availability; always include item_group_id from the canonical Product.id.
- id is Variant.sku verbatim. Do not normalize identifiers. Product/variant
  parent IDs must match. Draft/archived products or variants are skipped.
- Text uses NFC + outer trim, code-point limits, no silent truncation. Title is
  canonical title plus known color/size details; no guessed sizes or claims.
  Caller supplies the finished variant landing URL; it is never constructed.
- Feed limits: IDs 127; title 500; description 10000 plain text; landing URL 511;
  image URL 2000; brand 100; MPN 70 alphanumeric; color/size/material/pattern 30;
  product_type 1000 with at most five nonempty ' > '-separated levels.
- URLs are absolute http(s), credentials/control/whitespace/backslash-free,
  returned unchanged. Image URL commas must already be percent-encoded.
- EUR/TRY only in this first implementation (application subset, not a claim
  about Pinterest currency support). Integer minor-unit prices use BigInt and
  exactly two decimals. Compare-at becomes price and current price sale_price;
  no compare-at means only price. Canonical price invariants still apply.
- Availability maps in_stock/out_of_stock/preorder to feed values with spaces;
  backorder is rejected because this feed specification has no corresponding
  supported value. Zero known inventory with in_stock is rejected.
- Optional fields: condition, brand, GTIN (exact documented feed column case),
  mpn, color, size, material, pattern, product_type, gender, age_group (child ->
  kids), and up to ten additional images. Do not infer size_type/size_system:
  canonical tall and multi-value types cannot safely map to the feed's singular
  big_and_tall type. More than ten additional images is an error, never a hidden
  truncation. Canonical GTIN checksum rules apply, with coupon prefixes rejected.
- Reparse canonical records using existing schemas; do not change those schemas
  or import platform-specific Google mapper modules.
- Batch conflicts reject every member of a duplicate SKU or GTIN group and
  conflicting product families (mixed currency, duplicate color/size). Sort valid
  rows by ID using ordinal comparison; diagnostics retain source indices.
- CSV has a fixed header, quoted fields, escaped quotes and CRLF records, with
  array image links joined by commas. Reject formula-leading text/identifiers
  rather than prepend apostrophes that would change product data. Any invalid
  active offer blocks the whole CSV; an empty/all-skipped catalog is refused.
- Bound previews to 1000 inputs and 16 MiB encoded CSV (local safety limits).
- Proposal snapshots are reparsed, cloned and validated, target one item ID, and
  carry static rationale listing changed/mapped fields. No persistence/apply.

## Validation and release gates

Tests first for exact EUR/TRY pricing, variants, skip/error states, canonical and
channel validation, Unicode boundaries, URL identity, CSV quoting and formula
injection, batch conflicts/order, immutable inputs/snapshots and no-I/O imports.
Run full tests, typecheck, lint, build, audit and git diff --check; open a draft
PR with actual validation results. Public pages/feeds must not be published.

The output is a local syntax/semantic preview, not evidence of catalog approval.
Image dimensions/reachability, actual storefront price/stock/title agreement,
media provenance/AI disclosure, website claim, merchant policies, country/language
configuration, and consent-aware tag installation require separate live checks.

## Implementation checkpoint — 2026-10-23

Implemented the offline contract above. The full suite passes 868 tests in 23
files, including 107 Pinterest tests. Typecheck, lint, production build and
`git diff --check` pass; `npm audit --audit-level=low` reports zero known
vulnerabilities. These are local checks; CI is reported on the pull request.
No live catalog request, Cloud resource or store change was made. ADR 0006
remains proposed pending independent review. Merge security PR #14 first, then
retarget the stacked Pinterest PR to main and rerun required checks.

The first CI run then reported GHSA-mrhx-c7xc-m3w5 in Zod <4.6.6, which the
earlier local audit had not surfaced. Security PR #14 was updated to Zod 4.6.7
and that dependency fix was incorporated here. All 868 tests, typecheck, lint
and production build still pass. CI must pass on the updated commits before
either PR is considered for merge; the earlier green security run is historical.
