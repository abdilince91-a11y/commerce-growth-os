# ADR 0006: Offline Pinterest retail catalog adapter

Status: **Proposed — implemented, pending independent review** (2026-10-23).

## Decision

Implement milestone 5 as a pure adapter under `src/lib/merchant/pinterest/`.
It consumes canonical ProductRecord/VariantRecord pairs and a finished landing
URL, returning mapped/skipped/invalid results. `mapOffers` validates conflicts;
`createCatalogPreview` emits a fixed-column UTF-8 CSV string only when all active
offers are valid and at least one is mapped. `toFeedUpdateProposal` prepares a
validated, detached `feed_update` snapshot targeting `pinterest_catalog_item`.
No function obtains credentials, reads an environment variable, talks to a
platform/database, writes a file, hosts a feed or applies a proposal.

Use Pinterest **retail data-source** field names, including the documented
`GTIN` column casing. Do not confuse this row with a REST batch item: there is
no API country/language/operation envelope and `id` is not an API `item_id`.
CSV is returned as a string to a caller, never published by the adapter.

Identity follows ADR 0003: SKU is the item ID, Product.id is the group ID, and
Variant.productId must match. IDs and URLs are returned verbatim. Human-readable
text is NFC-normalized and outer-trimmed, never silently shortened. Compose
the title from the canonical name plus supplied color/size; check it against
the variant landing page before any eventual publication. Description HTML is
rejected rather than stripped. The caller must supply deliberate plain text.

Use exact BigInt arithmetic on canonical integer minor units. EUR/TRY are the
initial application subset; both use two fractional digits. The compare-at
price becomes regular price and the current amount becomes sale_price. Refuse
unsupported currency and availability values rather than guessing; backorder
has no documented equivalent among this feed's accepted availability values.
Known zero inventory cannot be advertised in stock. Canonical validation still
requires GTIN or MPN; channel validation adds the narrower documented MPN limit
and excludes coupon GTIN prefixes. Missing brand is not invented.

Batch validation rejects all active members of duplicate SKU/GTIN groups,
conflicting color/size combinations and product families using mixed currencies.
A bad active row blocks the whole CSV instead of silently making a partial
catalog. Draft/archived records are intentionally skipped before commerce-field
validation. Rows are sorted by ordinal ID; invalid/skipped diagnostics retain
source array indices. Issues use fixed codes, messages and field paths without
copying source values or arbitrary attribute keys into errors.

Quote every CSV cell, double embedded quotes, and use CRLF record boundaries.
Quoting does not neutralize spreadsheet formulas: formula-leading text and IDs
are rejected as an explicit local safety restriction, including leading +, -, =
and @. Do not add an apostrophe that would change the feed's product values.
Preview caps of 1000 inputs and 16 MiB encoded output bound local work; these
are deliberately much smaller than Pinterest's catalog capacity.

This subset omits size_system, size_type, tax/shipping fields, custom labels,
AI disclosures and other attributes without a verified canonical mapping. In
particular canonical tall is not silently recast as big_and_tall. An explicit
warning accompanies every mapped item: external publication checks are still
required. Additional images are deduplicated in source order; excess images
cause an error instead of being hidden. Unknown input fields do not enter rows.

## Verification and remaining gates

Tests cover prices, normalization/limits, lifecycle, parent relationships,
unsafe URLs, plain text and formula safety, GTIN/MPN, inventory, images, batch
conflicts, deterministic CSV, snapshot validation and input immutability. An
AST-based import/identifier guard discovers all shipped sibling modules and
checks the offline dependency allowlist. It is a regression guard, not a proof
against deliberately obfuscated code. Runtime changes still require review.

No live Pinterest or Shopify account was used. A preview does not prove image
dimensions, accessibility, media provenance, landing-page title/price/stock
agreement, merchant eligibility, website ownership, feed country/language, tag
consent or catalog approval. Those checks and any upload/hosting/transport need
separate scope and human approval. This ADR does not accept ADR 0005 or expand
the Merchant reader's privileges. No schema migration or dependency is added.

## Sources checked 2026-10-23

- Retail feed rules:
  https://help.pinterest.com/en/business/article/before-you-get-started-with-catalogs
- API envelope distinction:
  https://developer.pinterest.com/docs/work-with-catalogs/modify-items-in-batch/
