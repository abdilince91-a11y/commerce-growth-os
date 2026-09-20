# Google Merchant Adapter — v0.1 Implementation Plan

Status: DRAFT (revision 7) — Slice 0 is merged (PR #5, merge commit
`fcaa5fb`). The later slices and the live phases follow the order and gates
in §11; each still needs its own go-ahead.
Branch: written on `feat/google-merchant-adapter` (merged); Slice 0 step 2
was merged from `feat/canonical-variant-schema` (PR #5).
Milestone: step 4 of `docs/plans/v0.1.md` §6.
Written: 2026-09-19 · Revised: 2026-09-20 (slice order with a new Slice 0,
confirmed live-phase facts, the Slice 0 decisions recorded in ADR 0003,
and ADR 0003's acceptance with Slice 0 step 2; see §14)

Scope of this document: it describes the plan. As of revision 7, Slice 0
(ADR 0003 accepted; the additive Prisma schema and canonical Zod schemas)
is implemented and merged (PR #5, `fcaa5fb`). **Not implemented by Slice 0:** any migration, Merchant mapper, Google
client, transport, proposal execution, OAuth, or live-account work.

Implementation order (details in §11):
Slice 0 canonical Product/Variant ADR and schema decision → Slice 1 pure
validation and mapping utilities → Slice 2 fixture-based Merchant payload
mapper → Slice 3 proposal preview integration → Slice 4 offline
verification → *future phase* authenticated read-only Merchant connection
→ *later phase* human-approved write transport.

## 1. Goal and hard boundaries

Map canonical product data into **Google Merchant API** product payloads
as pure, deterministic, fully tested functions, and expose the result
only as previews wrapped in `Proposal` records.

v0.1 is **fixture-only**. This milestone must not:

- use real credentials, OAuth flows, or service accounts
- make any network or Google API call (no `fetch`, `http`, `googleapis`)
- create or edit any `.env` file
- connect to or migrate a database (no database was inspected, so whether
  any holds `Product` rows is unknown; any migration SQL from Slice 0
  needs its own explicit approval and is never applied here)
- submit, update, or delete products in Merchant Center
- bypass the human approval gate (ADR 0002)

There is deliberately **no transport implementation** in Slices 0–4.
Nothing in the new code can reach Google, so "generated payloads cannot
be applied" holds structurally, not just by convention. Live phases are
described only as constraints in §8.3 and §11.

### API target: Merchant API v1, not Content API for Shopping

The Content API for Shopping sunset on **August 18, 2026**, with
progressive errors from September 1, 2026, so it is already off the
table. This adapter targets the **Merchant API** (`products/v1`). The
payload shape below is the `accounts.productInputs` resource, which is
what API-source data sources accept for inserts.

Sources (fetched 2026-09-19):

- Overview: https://developers.google.com/merchant/api/overview
- Compatibility guide: https://developers.google.com/merchant/api/guides/compatibility/overview
- Product data specification: https://support.google.com/merchants/answer/7052112
- Add/manage products guide (request example): https://developers.google.com/merchant/api/guides/products/add-manage

## 2. Findings from repository inspection

Inspected: `CLAUDE.md`, `docs/plans/v0.1.md`, `docs/decisions/0000–0002`,
`prisma/schema.prisma`, `src/lib/schema/{product,proposal}.ts`,
`src/lib/proposals.ts`, both test files, and `package.json` scripts
(`test`, `lint`, `typecheck`, `build`). These shape the design:

| # | Finding | Consequence for this plan |
|---|---|---|
| F1 | **There is no `Variant` model.** Canonical `Product` has a unique `sku`, free-form `attributes`, and no `itemGroupId`. | **Decided and implemented (Q1, ADR 0003 Accepted):** a first-class canonical `Variant` model (Option C). `offerId = Variant.sku`; `itemGroupId` is `Product.id` verbatim and is not stored. |
| F2 | Canonical `Product` has **no `link`, `condition`, `contentLanguage`, `feedLabel`, or `availabilityDate`**. Merchant requires a landing-page `link`; preorder/backorder need an availability date. | **Decided (Q1):** `condition` is canonical `Product` data; `availability` and `availabilityDate` are canonical `Variant` data; `contentLanguage`/`feedLabel` are Merchant channel configuration; landing-page URLs are storefront-derived context. |
| F3 | ADR 0001 says price is "decimal in the Zod/API layer", but `ProductInputSchema.priceAmount` is `z.number().int()` — i.e. **integer minor units**, matching Prisma `Int`. | **Decided (Q2):** `priceAmount` is integer minor units. The correction is made through ADR 0003 (accepted); ADR 0001's body is unchanged and carries only a minimal cross-reference note. |
| F4 | `ProductInputSchema` validates `images` with `z.string().url()`. Verified locally: it **accepts** `javascript:alert(1)`, `data:` URIs, `ftp:`, and URLs with embedded credentials. | The canonical schema now rejects these (`HttpUrlSchema`, Slice 0 step 2). The adapter still re-validates scheme (`http`/`https` only) and rejects credentials, because raw rows can bypass Zod, and strips nothing silently. Untrusted-input rule in `CLAUDE.md`. |
| F5 | Prisma returns `null` for nullable columns, but `z.string().min(1).optional()` **rejects `null`** (verified). A raw DB row will fail `ProductInputSchema`. | **Decided and implemented (Q3):** `null → undefined` normalization happens at the named **persistence boundary**, `src/lib/schema/persistence-boundary.ts` (`parseProductRow` / `parseVariantRow`), which adapters read through; the canonical Zod schemas are not loosened to accept `null`. |
| F6 | `priceAmount` allows `0` and unsafe integers (verified: `2**60` passes `.int()`). Merchant rejects zero prices except narrow cases. | The canonical schema now requires a positive integer within the 32-bit range (Slice 0 step 2). The adapter still validates `Number.isSafeInteger` and rejects zero as a structured error, because raw rows can bypass Zod. |
| F7 | `proposals.ts` has **no `createProposal`**; it only approves, rejects, and flips to applied. `applyProposal` performs no side effect beyond the status change. | **Decided (Q4):** `createProposal` is **not** added in this milestone. The adapter returns a validated `ProposalCreateInput` only. |
| F8 | `Proposal.before/after` are required `Json`; Prisma cannot store a bare JS `null` there. | `before` uses an explicit sentinel object, never `null` (§8). |
| F9 | ADR 0001 required at least one of `gtin`/`mpn` via a Zod refinement, not a DB constraint; ADR 0003 moves that rule to `Variant`. Raw rows can bypass it. | Adapter re-validates identifiers; it never assumes the input was Zod-parsed. |

## 3. Proposed architecture

Everything below is pure (no I/O, no clock, no randomness, no globals),
so results are reproducible and trivially testable.

```
canonical Product + Variant rows + channel config + storefront link
        │
        ▼  parseProductRow()/parseVariantRow()   persistence boundary: null → undefined, Zod-validate
        ▼  validate*()             structured issues, never throws for bad data
        ▼  mapProductToMerchantInput()
        ▼
MerchantProductInput  (payload preview + productInputId)
        │
        ▼  toFeedUpdateProposal()  → ProposalCreateInput (type: feed_update)
        ▼
   [ existing approval gate — ADR 0002 — unchanged ]
```

### 3.1 Transport-independent interface

```ts
// src/lib/merchant/google/adapter.ts
export interface GoogleMerchantAdapter {
  /** Pure. Maps one canonical offer to a Merchant API preview. */
  mapProduct(input: MerchantOfferInput): MappingResult<MerchantProductInput>;

  /** Pure. Maps a batch; validates cross-product rules (duplicate offerIds,
   *  variant groups). Output order is sorted by productInputId. */
  mapProducts(inputs: readonly MerchantOfferInput[]): BatchMappingResult;

  /** Pure. Wraps a valid preview into a Proposal create-input. */
  toFeedUpdateProposal(preview: MerchantProductInput, meta: PreviewMeta): ProposalCreateInput;
}

export type MappingResult<T> =
  | { ok: true; value: T; warnings: MerchantIssue[] }
  | { ok: false; issues: MerchantIssue[] };
```

The adapter knows nothing about accounts, data sources, tokens, HTTP, or
retries. Those belong to later phases, which are **not built in Slices
0–4** (§8.3 records the confirmed facts and constraints for them).

### 3.2 Payload type (`products/v1` `productInputs`)

The example request in Google's add/manage guide confirms this shape:
`POST .../products/v1/accounts/{id}/productInputs:insert?dataSource=...`
with `offerId`, `contentLanguage`, `feedLabel`, and `productAttributes`.

```ts
export interface MerchantProductInput {
  /** contentLanguage~feedLabel~offerId — see §4.3 */
  productInputId: string;
  offerId: string;
  contentLanguage: string;   // e.g. "tr"
  feedLabel: string;         // e.g. "TR"
  productAttributes: {
    title: string;
    description: string;
    link: string;
    imageLink: string;
    additionalImageLinks?: string[];
    price: { amountMicros: string; currencyCode: string }; // §4.4
    availability: "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER" | "BACKORDER";
    availabilityDate?: string;   // ISO 8601, required for PREORDER/BACKORDER
    condition: "NEW" | "USED" | "REFURBISHED";
    gtins?: string[];
    mpn?: string;
    brand?: string;
    itemGroupId?: string;
    color?: string; sizes?: string[]; material?: string;
  };
}
```

`amountMicros` is confirmed as a **JSON string** (ADR 0003 D11) and is
always computed with **exact BigInt** arithmetic. Strings are also the
safe choice because the API field is `int64` and micros can exceed
`Number.MAX_SAFE_INTEGER` (verified: 999,999,999,999 minor units of a
2-decimal currency is `9999999999990000` micros, above `9007199254740991`).
Note that Prisma `Int` caps a stored price at 2,147,483,647 minor units,
so that large value is a pure-function test case, not a storable price.

## 4. Mapping rules

### 4.1 Field mapping

| Merchant field | Source | Rule |
|---|---|---|
| `offerId` | `Variant.sku` | ≤ 50 chars; must not contain `~`, `/`, `%`, whitespace or control chars (§4.3) |
| `contentLanguage` | Merchant channel configuration | 2-letter lowercase ISO 639-1; not product data |
| `feedLabel` | Merchant channel configuration | uppercase letters/digits/`-`/`_`; must not contain `~`; not product data |
| `title` | derived variant title: `Product.title` plus the variant's distinguishing color/size (ADR 0003 D21; `Product.title` itself stays canonical, and the derivation belongs to the future mapper) | NFC-normalized, trimmed; ≤ 150 **code points**; error (never silent truncation) if longer |
| `description` | `Product.description` | NFC-normalized, trimmed; ≤ 5000 code points; same rule |
| `link` | storefront-derived context | a finished absolute URL supplied by a storefront link resolver (built from `Product.handle` and the variant); `http`/`https` only; no embedded credentials; error otherwise (F4) |
| `imageLink` | `Variant.imageUrl`, else `Product.images[0]` | same URL rules as `link` |
| `additionalImageLinks` | remaining `Product.images` | same URL rules; order preserved; capped at the documented maximum, error beyond it |
| `price` / `salePrice` | `Variant.priceAmount`, `Variant.compareAtPriceAmount` | `compareAtPriceAmount` is the regular/original price and is valid only when strictly greater than `priceAmount` (ADR 0003 D19). When present, `price` is the compare-at value and `salePrice` is `priceAmount`; otherwise `price` is `priceAmount` and there is no `salePrice`. An invalid comparison is an error |
| `price.amountMicros` (and `salePrice`) | `Variant.priceAmount`, `Variant.currency` | exact BigInt conversion (§4.4) of each amount; zero rejected; emitted as a JSON string |
| `price.currencyCode` | `Variant.currency` | canonical value is an uppercase three-letter code (`VarChar(3)`, not an enum); **at this adapter's boundary exactly `EUR` or `TRY` are supported** (ADR 0003 D7); a malformed code → `invalid_currency`, a well-formed unsupported code → `unsupported_currency` |
| `availability` | `Variant.availability` | explicit mapping table, canonical lowercase → Merchant uppercase: `in_stock→IN_STOCK`, `out_of_stock→OUT_OF_STOCK`, `preorder→PREORDER`, `backorder→BACKORDER` (the existing `Availability` enum, unchanged) |
| `availabilityDate` | `Variant.availabilityDate` | ISO 8601; nullable in the canonical model. Google Merchant requires it for PREORDER/BACKORDER, so `preorder`/`backorder` offers are mapped **only when it exists**, otherwise the offer is not mapped and returns `missing_availability_date` (ADR 0003 D13). It is a channel requirement, not a canonical rule |
| `condition` | `Product.condition` (default `new`) | explicit mapping table, canonical lowercase → Merchant uppercase: `new→NEW`, `used→USED`, `refurbished→REFURBISHED` |
| `gtins` | `Variant.gtin` | validated **exactly as supplied** (ADR 0003 D17): 8/12/13/14 ASCII digits with a valid GS1 check digit; never trimmed, stripped of spaces or dashes, or zero-padded, so a value containing spaces or dashes is invalid; all-zero and coupon-prefix (98/99) values are rejected (§4.5) |
| `mpn` | `Variant.mpn` | trimmed non-empty; ≤ 70 chars |
| `brand` | `Product.brand` | trimmed non-empty; ≤ 70 chars |
| `itemGroupId` | derived deterministically from `Product.id` | ≤ 50 chars; set on every offer of a product so it never changes when a variant is added (§4.2) |
| `color`, `sizes` | `Variant.color`, `Variant.size` | `sizes` is the single `size` as a one-element array |
| `material` | `Product.material` | trimmed non-empty |

Only offers whose `Product.status` and `Variant.status` are both `active`
are mapped; `draft` and `archived` records are skipped. The adapter never
emits a delete proposal (deletion is out of scope, `CLAUDE.md`).

Normalization is limited to NFC + trim so output is deterministic and
every change is explainable. Turkish text is a required fixture:
`toLocaleUpperCase("tr")` turns `i` into `İ`, so the adapter must never
change case.

### 4.2 Products, variants, and offer input (decided: first-class `Variant`)

Canonical data is a `Product` (the family) with one or more `Variant`s
(purchasable SKUs), per ADR 0003 (Accepted). One **offer** is one
`Variant` together with its parent `Product`:

```ts
export interface MerchantOfferInput {
  product: ProductInput;            // canonical parent, Zod-validated
  variant: VariantInput;            // canonical variant, Zod-validated
  channel: MerchantChannelConfig;   // contentLanguage, feedLabel — configuration, not product data
  link: string;                     // storefront-derived landing-page URL, already resolved
}
```

`MerchantOfferInput` is owned by the adapter and is the only thing the
mapper reads. The adapter does not own the storefront URL template; a
resolver outside the adapter builds `link` from `Product.handle` and the
variant, and fixtures supply it directly.

`itemGroupId` is derived deterministically from the stable `Product.id`
(a cuid; ADR 0003 proposes it verbatim, a short string well under the 50
limit) **at mapping time and is not stored** as duplicated canonical
data. It is set on **every** offer, including a product with a single
variant, so an offer's payload does not change merely because a sibling
variant is added later. `Product.handle` is never used for identity
because storefront slugs can change. Existing ids are unchanged
(`Product.id` and `Proposal.id` stay `cuid()`, and `Variant.id` is
`cuid()` too, ADR 0003 D9; no UUID conversion is proposed).
`Variant.sku` is unique and is the `offerId`.

`mapProducts` enforces batch rules:

- duplicate `offerId` (`Variant.sku`) within a `(contentLanguage, feedLabel)`
  scope → error
- two variants of one product with the same `color` and `size` (compared
  ignoring case, surrounding spaces, and Unicode composition; a variant with
  neither is exempt) → error `variant_not_distinguishable`. The canonical
  `ProductWithVariantsInputSchema` already rejects this (ADR 0003 D18); the
  adapter re-checks because raw rows can bypass Zod
- variants of one product using different currencies → error
  `mixed_currencies` (also rejected by the canonical schema)
- output sorted by `productInputId` so results never depend on input order

### 4.3 Deterministic identifiers

```
productInputId = `${contentLanguage}~${feedLabel}~${offerId}`
```

This matches the Merchant API format (the Content API's colon-separated
form becomes tilde-separated, and the `channel` segment is gone, per the
compatibility guide). Rules:

- pure function of its three inputs — no time, locale, or randomness
- each part is validated so none can contain `~` (which would make the
  identifier ambiguous); violations are structured errors, not escaping
- `offerId = Variant.sku` (decided, Q5; Google recommends the SKU)
- the full API resource name `accounts/{account}/productInputs/{id}`
  is a transport concern and is **not** built here

### 4.4 Exact price conversion (no floating point)

`Variant.priceAmount` is integer minor units (F3). The canonical
`Variant.currency` is a `VarChar(3)` validated only as an uppercase
three-letter ISO 4217-shaped code, so the canonical model is extensible
without a migration. **This adapter's v0.1 boundary supports exactly EUR
and TRY** (decided, Q7), and both use two minor-unit digits, so the
currency's ISO 4217 exponent `e` is `2` for each and:

```
amountMicros = BigInt(priceAmount) * 10n ** BigInt(6 - e)   // e = 2  →  × 10_000
```

The conversion stays parameterized by `e` so adding a currency later is a
table entry plus an ADR, not a rewrite.

- Only integer arithmetic; never `Number` division or multiplication.
  Float pitfalls are real (verified in Node: `1.005 * 1e6 = 1004999.9999999999`).
- `priceAmount` must satisfy `Number.isSafeInteger`; otherwise
  `price_not_safe_integer`.
- Any currency other than `EUR` or `TRY` (including well-formed codes
  such as `USD`, `JPY`, `KWD`) → `unsupported_currency`, never a guessed
  exponent. A small explicit table is used instead of `Intl`, whose data
  depends on the runtime's ICU build.
- Exponent > 6 is unsupported (none exist in ISO 4217 today).
- Zero → `price_zero_not_allowed` (Merchant spec).
- A second helper, `decimalStringToMicros("19.99", currency)`, is the
  exact decimal-string entry point (for example for importing feed or
  storefront prices). It accepts only `^\d+(\.\d+)?$`, rejects exponent
  notation, signs, and more fractional digits than the currency allows,
  and splits the string — no `parseFloat`.

Worked examples (become test cases):

| Input | Result |
|---|---|
| `1999` EUR | `"19990000"` |
| `1999` TRY | `"19990000"` |
| `1` EUR | `"10000"` |
| `2147483647` TRY (Prisma `Int` max) | `"21474836470000"` |
| `999999999999` EUR (pure-function case, above `Int` max) | `"9999999999990000"` |
| `"19.99"` EUR | `"19990000"` |
| `"19.999"` EUR | error `price_too_many_decimals` |
| `1999` USD | error `unsupported_currency` (well-formed, not supported here) |
| `1500` JPY | error `unsupported_currency` |
| `1999` `eur` / `EU` / `EURO` / empty | error `invalid_currency` (malformed) |
| `0` EUR | error `price_zero_not_allowed` |

### 4.5 GTIN and other identifiers

- GTIN rules follow accepted ADR 0003 D17, which governs over Google's
  specification wording that dashes and spaces are ignored. A GTIN is
  validated **exactly as supplied**: 8, 12, 13, or 14 ASCII digits with a
  valid GS1 check digit. It is never trimmed, stripped of spaces or dashes,
  zero-padded, or otherwise rewritten, and a value with spaces or dashes is
  invalid. All-zero values are rejected, and so are coupon prefixes (98 or 99
  at the start of a 13-digit GTIN, or of the embedded GTIN-13 of a 14-digit
  GTIN; not applicable to GTIN-8 or GTIN-12). The adapter's `gtin.ts` reuses
  the canonical checksum rules.
- Missing both `Variant.gtin` and `Variant.mpn` → `missing_identifier`
  error (the ADR 0001 rule, which ADR 0003 moves from `Product` to
  `Variant`; re-checked because raw rows can bypass Zod — F9).
- `mpn` without `brand` → error (an MPN is only meaningful with a brand);
  a GTIN without `brand` → warning.
- `identifier_exists=false` (custom goods) is out of scope for v0.1.

## 5. Structured validation errors

Validation returns data; it never throws for bad product data (only for
programmer errors).

```ts
export interface MerchantIssue {
  code: MerchantIssueCode;         // stable machine-readable enum
  severity: "error" | "warning";
  path: string;                    // e.g. "product.gtin", "product.images[2]"
  message: string;                 // static template — never echoes the raw value
  offerId?: string;                // sanitized, length-capped
}
```

Codes (initial set): `missing_required_field`, `missing_identifier`,
`invalid_gtin`, `mpn_requires_brand`, `invalid_currency`,
`unsupported_currency`, `price_zero_not_allowed`,
`price_not_safe_integer`, `price_too_many_decimals`, `invalid_url`,
`unsafe_url_scheme`, `url_has_credentials`, `title_too_long`,
`description_too_long`, `too_many_images`, `invalid_offer_id`,
`invalid_content_language`, `invalid_feed_label`,
`missing_availability_date`, `duplicate_offer_id`,
`variant_not_distinguishable`, `mixed_currencies`.

All issues for one product are collected in a single pass (the caller
sees every problem, not just the first).

## 6. Fixture-based tests (Vitest, no network, no DB)

Fixtures live in `src/lib/merchant/google/__fixtures__/` as typed `.ts`
modules. Tests live next to the code and match the existing
`src/**/*.test.ts` include.

| Group | Cases |
|---|---|
| Valid mapping | full product → exact expected payload (snapshot-free, explicit `toEqual`) |
| Multiple variants | 3 variants of one product → one derived `itemGroupId`, distinct `offerId`s; a single-variant product still gets `itemGroupId`; `itemGroupId` unchanged when `Product.handle` changes; sorted output; duplicate `offerId`; same-color-and-size variants → `variant_not_distinguishable` error; mixed currencies in one product → `mixed_currencies` error |
| Missing identifiers | neither gtin nor mpn on the variant; mpn without brand; bad GTIN checksum; wrong length; all-zero; coupon prefix; spaces/dashes rejected (never normalized); a GTIN whose leading zero was dropped is not repaired |
| Currency / price | `EUR` and `TRY` accepted; well-formed unsupported codes (`USD`, `JPY`, `KWD`) → `unsupported_currency`; malformed (lowercase, wrong length, empty) → `invalid_currency`; zero; unsafe integer; decimal-string edge cases |
| Availability / condition | all four availability values; all three conditions; default condition `new`; `preorder`/`backorder` **with** `availabilityDate` mapped, **without** it not mapped (`missing_availability_date`) |
| Enum mapping tables | every canonical lowercase enum member (`availability`, `condition`) has an entry in its explicit mapping table and maps to the matching Merchant uppercase value (`in_stock→IN_STOCK`, `new→NEW`, …); no other value is accepted, including already-uppercase input |
| Lifecycle | `draft`/`archived` product or variant skipped; no delete proposal is ever produced |
| Channel and link | `contentLanguage`/`feedLabel` come only from channel config; `link` is used as supplied and never derived from the handle by the adapter |
| Unicode | Turkish (`İstanbul Çanta`, dotless-i), CJK, emoji ZWJ sequence (5 code points, 8 UTF-16 units), NFC vs NFD equivalence, RTL text; 150-code-point boundary exactly at, and one past, the limit |
| Exact `amountMicros` | the table in §4.4, including the above-safe-integer case |
| URL safety | `javascript:`, `data:`, `ftp:`, credentialed URL, relative URL |
| Determinism | same input twice → deep-equal; shuffled batch → identical sorted output; no `Date.now`/locale dependence |
| Identifiers | `productInputId` format; `~` in any part rejected; ≤ 50 chars |
| Proposal | see §7 |
| Guard | see §8.2 |

Tests are written before implementation where practical (`CLAUDE.md`
workflow step 6), starting with `money` and `identifiers`.

## 7. Integration with the Proposal workflow

```ts
toFeedUpdateProposal(preview, { before, rationaleContext }): ProposalCreateInput
// validated with the existing ProposalCreateInputSchema
```

| Proposal field | Value |
|---|---|
| `type` | `"feed_update"` (already in `ProposalTypeSchema`) |
| `targetEntity` | `"google_merchant_product_input"` |
| `targetId` | `productInputId` |
| `before` | previous payload if provided, else `{ "state": "absent" }` — never bare `null` (F8) |
| `after` | the full `MerchantProductInput` |
| `rationale` | generated, deterministic, non-empty: which canonical fields produced which Merchant fields, plus any warnings (satisfies "every recommendation must be explainable") |
| `createdBy` | `"system"` |

- **One proposal per offer** (one `Variant` with its parent `Product`),
  never per batch (decided, Q6 / ADR 0003 D9), so approval is granular
  and auditable and matches ADR 0002's single-entity `targetId`. The
  unique `sku` maps each proposal back to its `Variant`. Batch grouping is
  out of scope.
- The adapter never sets `status`, `decidedBy`, or `decidedAt`; the
  database default `pending` applies.
- Only mapping results with `ok: true` can become proposals. A result
  with errors returns issues and no proposal.
- **`createProposal` is not added in this milestone** (decided, Q4 /
  ADR 0003 D8; F7). The adapter returns a validated `ProposalCreateInput`
  and stops there; persisting it belongs to a later milestone, which would
  parse with `ProposalCreateInputSchema`, never accept a status, and be
  tested without a real database.

## 8. Safety, logging, and the approval gate

### 8.1 Sensitive-data-safe logging and errors

- No logger dependency. The adapter returns issues; callers decide what
  to emit.
- Issue `message` values are static templates. They never include the
  offending product value, a full URL, or a description.
- Anything that does reach a log must go through a small `safeIssueSummary`
  helper: issue `code`, `path`, `severity`, counts, and a sanitized
  `offerId` (control characters stripped, length-capped). Never payloads,
  descriptions, image/link URLs (query strings can carry tokens), or any
  credential.
- There are no credentials in this milestone. The offer-input and
  channel-config types have no account, token, or secret fields, so none
  can be threaded through by accident.
- Error cases use typed results; thrown errors are reserved for
  programmer mistakes and carry no product data.

### 8.2 Enforcing "no network, no apply" mechanically

Two layers, both cheap:

1. **ESLint override** for `src/lib/merchant/**`: `no-restricted-imports`
   for `node:http`, `node:https`, `node:net`, `axios`, `googleapis`,
   `@/lib/db`, and `@/lib/proposals`; `no-restricted-globals` for
   `fetch`. This is the only config change planned.
2. **A guard test** that reads the module's source files and fails if any
   restricted import or `fetch` appears.

Because the module cannot import `@/lib/proposals`, it cannot call
`applyProposal` at all. `toFeedUpdateProposal` imports only the Zod
schema from `@/lib/schema/proposal`.

### 8.3 Future live phases (documentation only; nothing here is built or started)

A real Merchant Center account exists for a later integration. Slices
0–4 never touch it, and no credential, token, client secret, or
service-account key is requested, created, printed, or stored by this
plan or by those slices.

**Confirmed facts recorded for the live phase** (and only these):

1. The Merchant API does **not** support API keys for authentication.
2. **OAuth 2.0 is required.**
3. The product API authorization scope is
   `https://www.googleapis.com/auth/content`.
4. A **dedicated Google Cloud project** is required.
5. Merchant API **developer registration links the Cloud project to the
   Merchant Center account**.
6. The user performing registration must have **Merchant Center Admin**
   access.
7. **Product insertion requires an API data source.**
8. The `content` scope is **not a read-only scope**. The first live
   connection must therefore be read-only **through application
   behavior**: implement only `list` and `get` operations, and define
   **no insert, update, or delete transport methods** at all.

Basis: recorded as confirmed in the 2026-09-20 review and consistent with
Google's [authorization overview](https://developers.google.com/merchant/api/guides/authorization/overview),
[API data sources guide](https://developers.google.com/merchant/api/guides/data-sources/api-sources),
and [OAuth scopes reference](https://developers.google.com/identity/protocols/oauth2/scopes).
The exact scope string was seen only in a search summary of Google's
documentation, not on the Merchant API authentication page, so re-check it
on the official scopes page before the read-only phase begins.

**What "read-only through application behavior" means in code:** the
read-only phase exposes a client type whose methods are only list/get
style reads. Insert, update, and delete methods do not exist on any type
in that phase, so a write is impossible to express, not merely rejected
at runtime. The same lint-and-guard-test approach as §8.2 (restricted
imports plus a test that fails if a write-style method or endpoint name
appears) keeps it that way.

**Later write transport** (a separate phase, see §11): it must accept only
a proposal loaded from the database in status `approved` with a human
`decidedBy`, re-validate its `after` payload, and call `applyProposal`
only after a confirmed successful send. It needs its own ADR and security
review before merge, and an explicit human go-ahead.

**Merchant Center roles and permissions are deliberately not asserted
here.** Which access level a read-only user needs, whether a read-only
level can authorize and call list/get, and whether an "API developer"
level is required were not confirmed from an official page. They are
open questions (L1–L3 in §13) and do not block Slices 0–4.

## 9. Proposed files

New:

```
docs/plans/google-merchant-adapter.md                 (this file)
docs/decisions/0003-canonical-product-variant.md      (Slice 0: written and Accepted)
docs/decisions/0004-google-merchant-adapter.md        (Slice 4: fixture-only boundary, v1 API, read-only-first live phase)
src/lib/merchant/google/types.ts                      payload + input + issue types
src/lib/merchant/google/errors.ts                     issue codes, safeIssueSummary
src/lib/merchant/google/money.ts                      exponent table, minor-units/decimal → micros
src/lib/merchant/google/identifiers.ts                offerId/contentLanguage/feedLabel/productInputId
src/lib/merchant/google/gtin.ts                       exactly-as-supplied validation + GS1 checksum + coupon prefixes
src/lib/merchant/google/text.ts                       NFC/trim, code-point length
src/lib/merchant/google/urls.ts                       http/https-only URL validation
src/lib/merchant/google/mapper.ts                     mapProductToMerchantInput, mapProducts
src/lib/merchant/google/proposal.ts                   toFeedUpdateProposal
src/lib/merchant/google/adapter.ts                    GoogleMerchantAdapter interface + factory
src/lib/merchant/google/index.ts                      public exports
src/lib/merchant/google/__fixtures__/*.ts             typed fixtures
src/lib/merchant/google/*.test.ts                     one test file per module + guard test
```

Modified (small):

```
eslint.config.mjs        add the §8.2 override for src/lib/merchant/**
CHANGELOG.md             Unreleased entry
docs/plans/v0.1.md       tick step 4
```

Null normalization is not a Merchant-module file: it lives in the canonical
layer as `src/lib/schema/persistence-boundary.ts` (Slice 0 step 2), and the
adapter reads canonical data through it.

Not modified: `src/lib/proposals.ts` (Q4 decided: no `createProposal` in
this milestone).

Changed by Slice 0 (done; merged in PR #5, `fcaa5fb`): `prisma/schema.prisma` (additive
expand-phase schema), the canonical Zod schemas and their tests under
`src/lib/schema/`, ADR 0003 (accepted), and a minimal cross-reference note at
the top of ADR 0001. **No migration file was created or applied.** Creating
one is a further explicit approval.

Never modified by this plan: any `.env*` file, `.github/workflows/ci.yml`.

## 10. Dependencies

**None.** BigInt, `String.prototype.normalize`, and `URL` are built in;
`zod` and `vitest` are already installed. `tsconfig` targets ES2022, so
BigInt literals compile. No GTIN, currency, or money package is needed
for the scope above, and adding one would enlarge the supply-chain
surface for a few dozen lines of code.

## 11. Delivery order (each slice small, tested, reviewable)

Nothing below starts without an explicit go-ahead for that slice.
Approval for one slice does not carry to the next.

| Order | Slice | Nature |
|---|---|---|
| 0 | Canonical Product/Variant ADR and schema decision | decision, then (if approved) small schema change |
| 1 | Pure validation and mapping utilities | offline code |
| 2 | Fixture-based Merchant payload mapper | offline code |
| 3 | Proposal preview integration | offline code |
| 4 | Offline verification | verification, reviews, docs |
| Future phase | Authenticated read-only Merchant connection | live, read-only |
| Later phase | Human-approved write transport | live, writes |

### Slice 0 — Canonical Product/Variant ADR and schema decision (done; merged in PR #5, `fcaa5fb`)

Why first: the mapper's inputs depend on what the canonical record holds
(F1, F2), and a schema change is the most expensive thing to redo.

**Step 1 — done:** `docs/decisions/0003-canonical-product-variant.md` was
written and, on 2026-09-20, **Accepted**, with an explicit outcome for every
proposal (P1–P13) and open question (OQ1–OQ7).

**Step 2 — done (merged in PR #5, merge commit `fcaa5fb`):** the
additive expand-phase Prisma schema and the canonical Zod schemas with focused
unit tests. Nothing else: no migration, Merchant mapper, Google client,
transport, proposal execution, OAuth, or live-account work, and no database was
connected to (`prisma format`, `validate`, and `generate` ran with a
process-local dummy `DATABASE_URL` only).

The accepted decisions (the earlier defaults are replaced):

| Decision | Outcome |
|---|---|
| Variant representation (Q1, F1) | **Option C — a first-class canonical `Variant` model.** ONOE is an apparel business; size, color, SKU, price, inventory, and product-family relationships are domain data, not Google-specific adapter context |
| `Product` owns | `id`, `handle`, `title`, `description`, `brand`, `productType`, `material`, `condition` (default `new`), shared `images`, `tags`, `attributes` (channel-neutral escape hatch), lifecycle `status`, typed apparel metadata (`gender`, `ageGroup`, `pattern`, `sizeSystem`, `sizeTypes`), timestamps |
| `Variant` owns | `id`, `productId`, `sku` (unique), `gtin?`, `mpn?`, `priceAmount`, `compareAtPriceAmount?`, `currency`, `inventoryQuantity?`, `availability`, `availabilityDate?`, `color?`, `size?`, variant image URL?, lifecycle `status`, timestamps |
| Merchant identity (Q5) | `offerId = Variant.sku`; `itemGroupId` is `Product.id` verbatim and **not stored**; `contentLanguage`/`feedLabel` are channel configuration; storefront URLs remain adapter context (no Shopify-specific ids or URL rules); `condition` is `Product` data; `availability`/`availabilityDate` are `Variant` data |
| Ids | **Preserved.** `Product.id` and `Proposal.id` stay `cuid()`; no UUID conversion; `Variant.id` is `@default(cuid())` |
| Enum convention | **lowercase, matching the repository.** New enums are lowercase and channel-neutral; `Availability` and `Proposal*` are unchanged. The adapter maps canonical lowercase values to Google's uppercase enums in explicit tables |
| Prices (Q2) | integer minor units for v0.1; positive, within the 32-bit `Int` range; correction to ADR 0001 made through ADR 0003 |
| `compareAtPriceAmount` | the regular/original price, valid only when strictly greater than `priceAmount`; the mapper may later emit `price` plus `salePrice` |
| Currency (Q7) | canonical `currency String @db.VarChar(3)`, exactly three uppercase ASCII letters, **no** Prisma enum; the Merchant adapter v0.1 supports exactly **EUR and TRY** at its boundary |
| Inventory | `inventoryQuantity` is nullable: `null` means unknown, `0` means known zero; there is no default |
| GTIN | unique when present; 8/12/13/14 digits with a valid GS1 check digit; **never zero-padded or rewritten** |
| Family rules | unique `sku` and non-null `gtin`; duplicate non-null color/size combinations rejected by Zod (no database unique); one currency per product; an active `Product` needs at least one variant, drafts may have none |
| Null handling (Q3) | `null → undefined` at the persistence boundary (`src/lib/schema/persistence-boundary.ts`); canonical Zod is not loosened |
| Existing `Product` data | the legacy commerce columns are kept as nullable compatibility columns (additive expand phase); **conservative non-destructive backfill required** for the later migration, one default `Variant` per `Product`, verified before anything is removed. **No destructive column removal is authorized.** Database contents are unknown (ADR 0003 OQ6), so no claim is made about rows |
| Titles | `Product.title` stays canonical; the future mapper derives the variant title |
| `createProposal` (Q4) | not added in this milestone |
| Proposal granularity (Q6) | per product/variant offer, not batches |
| Preorder/backorder (Q8) | mapped only when `availabilityDate` exists (a channel requirement; nullable canonically) |
| `amountMicros` | JSON **string**, exact BigInt conversion (future mapper) |

**Not part of Slice 0:** the first migration. `prisma/schema.prisma` is not
migratable as-is (required columns such as `handle` and `productType` have no
defaults), so the migration must be hand-written to add, backfill, verify,
and only then enforce. It is authored, if at all, as a further approval, is
verified against a copy of real data, and is never applied without an explicit
go-ahead.

Exit (met): ADR 0003 accepted; schema and Zod updated; `prisma format`,
`validate`, and `generate`, `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, and lint after build pass. Slices 1–3 proceed against
`MerchantOfferInput` (§4.2) when separately approved.

### Slice 1 — Pure validation and mapping utilities

`money`, `identifiers`, `text`, `gtin`, `urls` with tests written first.
No mapper, no I/O. Covers exact `amountMicros`, `contentLanguage~feedLabel~offerId`,
NFC/code-point handling, GTIN checksum, and http/https-only URL checks.

### Slice 2 — Fixture-based Merchant payload mapper

`errors`, `types`, `mapper`, and the typed fixtures. Null normalization
is not part of this slice: it already exists as the canonical persistence
boundary (`parseProductRow`/`parseVariantRow`), which the mapper's inputs
come through. Covers valid mapping, multiple variants, missing
identifiers, currency/price errors, availability and condition mappings,
Unicode, and determinism (§6). Before the payload types are finalized,
the "Not yet verified" field-name items in §13 are checked against
Google's reference pages.

### Slice 3 — Proposal preview integration

`toFeedUpdateProposal`, the §8.2 ESLint override, and the guard test.
Previews only ever become `pending` `feed_update` proposals; the module
cannot import or call `applyProposal`. Q4 and Q6 are already decided:
no `createProposal` in this milestone, and one proposal per offer.

### Slice 4 — Offline verification

No new features. Run the full acceptance list (§12) with everything
offline: typecheck, lint, tests, build, lint after build, `npm audit`;
confirm no network, credential, `.env`, or database use; independent code
review and security review (`CLAUDE.md` workflow steps 9–10); write
`docs/decisions/0004-google-merchant-adapter.md`; update `CHANGELOG.md`
and tick step 4 in `docs/plans/v0.1.md`.

### Future phase — Authenticated read-only Merchant connection

**Not part of this milestone.** Starts only on an explicit human
go-ahead after Slice 4. Built on the confirmed facts in §8.3:
OAuth 2.0 (no API keys), a dedicated Google Cloud project, developer
registration by a Merchant Center Admin, an API data source, and the
`content` scope. Because that scope is not read-only, the connection is
read-only **by construction**: only list/get operations exist, and there
are no insert, update, or delete transport methods. Its own ADR and
security review come first. Merchant Center role questions (L1–L3) must
be answered before it starts.

### Later phase — Human-approved write transport

**Not part of this milestone.** Requires the read-only phase to be
accepted, its own ADR and security review, and an explicit human
go-ahead. Product insertion goes to an API data source, only from a
proposal already `approved` by a human, re-validated before sending.
Automatic deletion is never in scope (`CLAUDE.md`).

Every code slice (0 step 2, 1, 2, 3) ends with `npm run typecheck`,
`npm run lint`, `npm test`, `npm run build`, and lint again after build.

## 12. Acceptance criteria

- [ ] Uses Merchant API `products/v1` payload shapes; no Content API code
- [ ] No network call, credential, `.env`, or DB access anywhere in the module (ESLint + guard test pass)
- [ ] `productInputId` is exactly `contentLanguage~feedLabel~offerId` and deterministic
- [ ] `amountMicros` is exact for every case in §4.4, with no `Number` arithmetic on money
- [ ] All items in the §6 test matrix exist and pass
- [ ] Every validation failure is a structured `MerchantIssue`; none echoes raw values
- [ ] Generated previews only ever become `pending` `feed_update` proposals; the module cannot import or call `applyProposal`
- [ ] Slice 0 ADR (0003) accepted before Slice 1 starts; Prisma/Zod changed only as that ADR says, and unchanged by Slices 1–4
- [ ] `offerId = Variant.sku`; `itemGroupId` derived from `Product.id` and set on every offer; `contentLanguage`/`feedLabel` come only from channel config
- [ ] At the adapter boundary only `EUR` and `TRY` are accepted; every other well-formed currency returns `unsupported_currency` and a malformed one `invalid_currency`
- [ ] The canonical `currency` is `VarChar(3)` validated as `^[A-Z]{3}$`; no currency enum exists
- [ ] New canonical enums use lowercase values like the existing ones; no existing enum or id is changed; canonical-to-Merchant uppercase spellings are mapped by explicit, tested tables
- [ ] The Slice 0 migration (when separately approved) is non-destructive: no legacy `Product` column is dropped
- [ ] PREORDER/BACKORDER offers are mapped only when `availabilityDate` exists
- [ ] No client type in this milestone has insert, update, or delete methods; no transport of any kind exists
- [ ] No new dependencies; `npm audit` still reports 0 vulnerabilities
- [ ] typecheck, lint, tests, build, and post-build lint pass
- [ ] ADR 0004 written; CHANGELOG updated
- [ ] Independent code review and security review completed, findings resolved or documented

## 13. Open questions

### A. Decided (recorded in ADR 0003, status Accepted)

| # | Question | Decision |
|---|---|---|
| Q1 | Variant representation and where `link`, `condition`, `availabilityDate`, and `itemGroupId` live | **Decided:** first-class `Variant` model (Option C). `condition` on `Product`; `availability`/`availabilityDate` on `Variant`; `itemGroupId` is `Product.id` verbatim and not stored; landing-page URLs are storefront-derived adapter context; `contentLanguage`/`feedLabel` are channel configuration. |
| Q2 | ADR 0001 price wording | **Decided:** `priceAmount` is integer minor units. The correction is made through ADR 0003 (accepted); ADR 0001 carries only a minimal cross-reference note. |
| Q3 | Where `null → undefined` happens | **Decided and implemented:** at the named persistence boundary (`src/lib/schema/persistence-boundary.ts`), which adapters read through; the canonical Zod schemas are not loosened. |
| Q4 | `createProposal` | **Decided:** not added in this milestone. |
| Q5 | `offerId` source | **Decided:** `Variant.sku`. |
| Q6 | Proposal granularity | **Decided:** per product/variant offer, not batches. |
| Q7 | Supported currencies | **Decided:** the Merchant adapter v0.1 supports exactly `EUR` and `TRY` at its boundary. The canonical `currency` is `String @db.VarChar(3)` (Zod `^[A-Z]{3}$`), not a Prisma enum, so adding a currency never needs a migration. |
| Q8 | Preorder/backorder | **Decided:** mapped only when the required `availabilityDate` exists. |

### B. ADR 0003 proposals and open questions: resolved

ADR 0003 records the explicit outcome of every proposal (P1–P13) and open
question (OQ1–OQ7). Summary of what matters to this plan:

- **Accepted:** P1–P10 and P13 (P6 and P7 with corrections, below).
- **Superseded:** P11 (duplicate color/size is now rejected by Zod, still
  with no database unique) and P12 (`Product.title` stays canonical; the
  future mapper derives the variant title).
- **Inventory** is nullable: `NULL` means unknown, `0` means known zero
  (correcting P7's earlier "0 for unknown").
- **GTIN** is unique when present, validated (8/12/13/14 digits, GS1 check
  digit), and never padded or rewritten (P6, OQ7).
- **OQ1–OQ5 resolved:** typed apparel metadata; `compareAtPriceAmount` is the
  regular price only when greater, so the mapper may emit `price` plus
  `salePrice`; variant title derived by the future mapper; one currency per
  product; storefront URLs stay adapter context.
- **OQ6 unresolved by design:** whether any database holds `Product` rows is
  unknown and no claim is made; a human must verify it before a migration is
  authored, and the conservative backfill applies either way.

Still open (not blocking): whether `gender`, `ageGroup`, `color`, and `size`
become required for active products after migration; whether the duplicate
checks should relax for archived variants; and the size vocabularies. See
ADR 0003 "Remaining decisions".

### C. Live-phase questions (do not block Slices 0–4)

None of these are answered by an official page I could confirm, so none
is asserted anywhere in this plan.

| # | Question |
|---|---|
| L1 | Which Merchant Center access level must the user who authorizes the read-only connection have? Can a "read-only" level authorize and call list/get? (Google's Help Center describes a read-only level; the API's access-level documentation lists `ADMIN`, `STANDARD`, and `PERFORMANCE_REPORTING`. Not reconciled.) |
| L2 | Is an "API developer" access level required, and by whom (the registering user, the calling user, or both)? |
| L3 | Can an API data source be created in the Merchant Center UI, or only through the API, and which access level is needed to create it? |
| L4 | Which OAuth consent-screen status applies to a personal-account owner, and what does it mean for refresh-token lifetime? |
| L5 | Re-verify the exact `content` scope string on Google's official scopes page (§8.3 basis note). |
| L6 | What quotas and rate limits apply to the list/get methods? |
| L7 | Which `feedLabel`, `contentLanguage`, and countries apply to the real account? (The currencies are decided: EUR and TRY.) |
| L8 | Later phase: how is a write confirmed given asynchronous processing? |
| L9 | Later phase: where are OAuth tokens stored (database model vs host secret store)? Needs its own ADR. |

### Not yet verified (must be confirmed before Slice 2 finalizes types)

The Merchant API reference pages did not render through the documentation
fetcher, so these come from the guides and product spec plus general
knowledge and need a check against the reference:

- exact `productAttributes` names for `brand`, `mpn`, `itemGroupId`,
  `additionalImageLinks`, `availabilityDate`, `color`, `sizes`, `material`
- exact enum spellings beyond `IN_STOCK` and `NEW` (the guide example)
- documented maximums: additional images, link length, `mpn`/`brand` length
- `feedLabel` and `contentLanguage` constraints
- escaping rules for an `offerId` containing reserved characters
- whether MPN strictly requires brand
- whether the typed apparel metadata added in ADR 0003 (`gender`, `ageGroup`,
  `pattern`, `sizeSystem`, `sizeTypes`, `color`, `size`) fully covers
  Merchant's apparel requirements, and how each maps to Merchant's values

(`amountMicros` as a JSON string was on this list and is now a confirmed
decision, ADR 0003 D11.)

If any differs, the plan's types change but its structure does not. These
are confirmed at the start of Slice 2 and the answers recorded in
ADR 0004.

## 14. Revision log

**Revision 2 (2026-09-20)**

- Added **Slice 0** (canonical Product/Variant ADR and schema decision)
  ahead of all code, and reordered delivery to: Slice 0 → 1 → 2 → 3 →
  4 → future read-only phase → later approved-write phase (§11).
- F1, F2, F3, F5 now defer to Slice 0 instead of assuming "no schema
  change"; §4.2 reworked so the mapper is insulated from that decision.
- ADR numbering: 0003 is the Slice 0 Product/Variant ADR; the adapter
  boundary ADR moves to 0004 (Slice 4).
- §8.3 now records only the eight confirmed live-phase facts, the
  "read-only through application behavior, list/get only, no
  insert/update/delete methods" rule, and states that Merchant Center
  roles are not asserted.
- Removed a cross-reference to a separate live-phase document; this plan
  is self-contained on the live phase.
- Open questions regrouped into A (Slice 0), B (later offline slices),
  and C (live-phase, non-blocking: L1–L9).
- Acceptance criteria updated: Prisma/Zod change only as Slice 0's ADR
  says; no insert/update/delete client methods exist.

**Revision 3 (2026-09-20)**

- Slice 0 step 1: `docs/decisions/0003-canonical-product-variant.md`
  written with status **Proposed**, replacing the old Slice 0 defaults
  with the product owner's decisions (first-class `Variant`, `offerId`
  from `Variant.sku`, `itemGroupId` from `Product.id`, and the rest in
  §11 and §13.A).
- Q1, Q2, Q3, Q5, and Q7 marked decided, as requested. Q4, Q6, and Q8
  are also marked decided because the same decision set settles them.
- §2 (F1–F3, F5–F7), §3, §3.2, §4.1–§4.4, §5, §6, §7, §9, §11, and §12
  updated for the `Product`/`Variant` model; `single_variant_group` was
  dropped (a product with one variant is normal and still gets an
  `itemGroupId`).
- `amountMicros` string encoding removed from the unverified list.
- An earlier untracked scratch document about the live phase was
  verified as Claude-created and unreferenced by any tracked file, then
  deleted; live-phase questions L1–L9 are retained in §13.C.

**Revision 4 (2026-09-20, first owner review of ADR 0003)**

- **Currency:** canonical `currency` is `String @db.VarChar(3)` with Zod
  `^[A-Z]{3}$`, not a Prisma enum. "EUR and TRY only" applies at the
  Merchant adapter boundary (Q7); `invalid_currency` vs
  `unsupported_currency` distinguished in §4.1, §4.4, §6, and §12.
  *(Still in force.)*
- **Existing data:** Slice 0 requires a non-destructive backfill; no
  destructive column removal is authorized in Slice 0 (§11). *(Still in
  force; tightened in revision 5.)*
- **Constraints** documented in ADR 0003 (positive `priceAmount` within
  `Int` range, `compareAtPriceAmount >= priceAmount`, non-negative
  inventory, channel-driven `availabilityDate`, nullable-GTIN uniqueness,
  1:N relation with `ON DELETE RESTRICT`); nothing implemented. *(Superseded
  in revision 6: the comparison is now strictly greater, inventory is
  nullable, and the Zod rules are implemented.)*
- **ADR 0001 is not edited** in Slice 0 step 1: an earlier edit was
  reverted so only ADR 0003 and this plan change. *(Superseded in revision 6:
  ADR 0001 gains a minimal cross-reference note; its body is unchanged.)*
- Superseded in revision 5: this revision proposed UUID ids and UPPERCASE
  enum members. Both were dropped; see below.

**Revision 5 (2026-09-20, second owner review: repository conventions win)**

- **Ids preserved:** `Product.id` and `Proposal.id` stay `cuid()` and no
  existing id changes; no UUID conversion is proposed. `Variant.id` is
  `@default(cuid())`. `itemGroupId` is still derived from `Product.id` at
  mapping time and not stored; `offerId` is still `Variant.sku` (§4.2,
  §11).
- **Enums follow the repository (lowercase):** new `draft`/`active`/
  `archived` and `new`/`used`/`refurbished`; the existing `Availability`
  is reused unchanged and nothing existing is renamed. The adapter maps
  canonical lowercase to Google's uppercase enums in explicit tables
  (§4.1, §6, §11, §12). The previous enum-rename step and the `Proposal*`
  alignment question (old OQ8) are removed.
- **Repository facts** are now stated only as verified: no
  `prisma/migrations` directory; no database was connected to or
  inspected, so whether any holds `Product` rows is unknown. The earlier
  "there is no database" wording is removed (§1, §11, §13.B).
- **Backfill is required even if the project is believed empty**
  (emptiness is unverified), and stays non-destructive (§11; ADR 0003
  D10).
- ADR 0003 proposals renumbered P1–P13 and open questions OQ1–OQ7.
- *(Superseded in revision 6: at this point ADR 0003 was still Proposed and
  nothing was implemented.)*

**Revision 6 (2026-09-20, ADR 0003 accepted; Slice 0 step 2)**

- ADR 0003 **Accepted**, with every proposal (P1–P13) and open question
  (OQ1–OQ7) resolved explicitly (§13.B). P1–P10 and P13 accepted; P11 and P12
  superseded.
- **Slice 0 step 2 implemented** (uncommitted, `feat/canonical-variant-schema`):
  the additive expand-phase `prisma/schema.prisma` and the canonical Zod
  schemas with focused tests. No migration, mapper, client, transport,
  proposal execution, OAuth, or live-account work; no database was connected
  to.
- Decisions applied to the plan: `inventoryQuantity` nullable (`NULL` unknown,
  `0` known zero); GTIN unique when present, checksum-validated, never padded
  or rewritten; duplicate color/size rejected by Zod with no database unique;
  one currency per product; `compareAtPriceAmount` valid only when strictly
  greater (mapper may emit `price` plus `salePrice`); active product needs at
  least one variant; `Product.title` stays canonical with a derived variant
  title in the future mapper; typed channel-neutral apparel metadata;
  null normalization moved to the canonical persistence boundary.
- §2 (F1, F3–F6, F9), §3, §4.1, §4.2, §5, §6, §9, §11 (Slice 0, Slice 2), and
  §13 updated; new adapter error codes `variant_not_distinguishable` (now an
  error) and `mixed_currencies`.
- ADR 0001's body is unchanged; it gains only a minimal cross-reference note.
- Database contents remain unknown and no claim is made about rows.

**Revision 7 (2026-09-20, minimal update)**

- Slice 0 marked as merged: PR #5, merge commit `fcaa5fb`. This supersedes the
  "uncommitted" wording in revision 6.
- GTIN wording resolved in favor of accepted ADR 0003 D17 (§4.1, §4.5, §6, §9):
  a GTIN is validated exactly as supplied and never trimmed, stripped, or
  zero-padded, so spaces and dashes make it invalid; all-zero and 98/99 coupon
  prefixes are rejected.
- No other plan text was changed.
