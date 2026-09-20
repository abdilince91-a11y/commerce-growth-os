# ADR 0003: Canonical Product and Variant model

Status: **Accepted** (2026-09-20)
Proposed: 2026-09-20 · Accepted: 2026-09-20, with the resolutions recorded below
Amends: ADR 0001 (canonical product schema); see "Relationship to ADR 0001"
Related: ADR 0002 (approval gate), `docs/plans/google-merchant-adapter.md` (Slice 0)

Implemented so far (Slice 0 step 2): the additive expand-phase Prisma schema
in `prisma/schema.prisma` and the canonical Zod schemas in
`src/lib/schema/`. **Not** implemented: any migration, any Merchant mapper,
client, transport, proposal execution, OAuth, or live integration.

## Context

ONOE is an apparel business. Size, color, SKU, price, inventory, and the
relationship between a product and its variants are **domain data**, not
Google-specific adapter context. The earlier canonical schema (ADR 0001) had
a single flat `Product` carrying one `sku`, one price, one availability, and
a free-form `attributes` JSON. It could not represent a product family (one
shirt in five sizes and three colors) without duplicating parent data on
every row.

The Google Merchant adapter needs two stable identities: an offer identity
(one per purchasable SKU) and a group identity (the family). Deciding this
after the mapper is written would mean rework, so it is decided first.

### Verified facts about the repository

Only facts that were actually checked are recorded here.

- Before this change `prisma/schema.prisma` defined `Product` and `Proposal`
  only; there was no `Variant` model.
- There is no `prisma/migrations` directory in the repository.
- No database was connected to or inspected while preparing or implementing
  this ADR. **The contents of any database are unknown**, including whether
  any environment holds `Product` rows. The ADR neither assumes nor claims
  that any database is empty.
- `Product.id` and `Proposal.id` are `@default(cuid())`; ADR 0001 documents
  `id` as `string (cuid)`.
- Every existing Prisma enum uses **lowercase** values.
- The legacy `Product` had `sku`, `gtin`, `mpn`, `priceAmount`,
  `priceCurrency`, `availability`, `category`, `images`, and `attributes`,
  and **no inventory column**.
- The previous `ProductInputSchema` used `z.string().url()` (which accepts
  `javascript:`, `data:`, `ftp:`, and credentialed URLs) and
  `z.coerce.date()` (which turns `null` into the Unix epoch).

## Decisions

| # | Decision |
|---|---|
| D1 | **Option C:** a first-class canonical `Variant` model. |
| D2 | `Product` is the parent and owns shared data: `id`, `handle`, `title`, `description`, `brand`, `productType`, `material`, `condition` (default `new`), shared `images`, `tags`, `attributes`, lifecycle `status`, typed apparel metadata (D22), and timestamps. |
| D3 | `Variant` owns `sku` (unique), `gtin`/`mpn`, `priceAmount`, `compareAtPriceAmount`, `currency`, `inventoryQuantity` (nullable, D16), `availability`, `availabilityDate`, `color`, `size`, an optional variant image URL, lifecycle `status`, and timestamps. |
| D4 | **Merchant identity:** `offerId` is `Variant.sku`. `itemGroupId` is **`Product.id` used verbatim** and is **not stored** as duplicated canonical data. `contentLanguage` and `feedLabel` are Merchant channel configuration. Storefront URLs remain **adapter context**; no Shopify-specific ids or URL rules are added. `condition` is canonical `Product` data. `availability` and `availabilityDate` are canonical `Variant` data. |
| D5 | Prices are **integer minor units** for v0.1. ADR 0001's "decimal in the Zod/API layer" was wrong; it is corrected here (see "Relationship to ADR 0001"). |
| D6 | `null → undefined` normalization happens at a named **persistence boundary**, `src/lib/schema/persistence-boundary.ts`. The canonical schemas do **not** accept `null` and are not weakened. Adapters read canonical data through that boundary. |
| D7 | **Currency:** canonical field `currency String @db.VarChar(3)`; canonical validation is **exactly three uppercase ASCII letters** (ISO 4217 shape, not list membership); the Google Merchant adapter v0.1 allowlist is **exactly `EUR` and `TRY`** at its own boundary. **No Prisma currency enum.** |
| D8 | **Enum convention: lowercase, matching the repository.** New enums `LifecycleStatus`, `ProductCondition`, `Gender`, `AgeGroup`, `SizeType` are lowercase. The existing `Availability` and `Proposal*` enums are unchanged. Apparel enums are channel-neutral and do not copy any platform's API spelling. Mapping to external spellings happens in explicit adapter tables. |
| D9 | **Identifiers are preserved.** `Product.id` and `Proposal.id` stay `cuid()` and every existing id is unchanged. `Variant.id` is `@default(cuid())`. A cuid is a short, immutable string, suitable as a deterministic Merchant identifier; no UUID migration is justified. |
| D10 | **Additive expand phase:** the legacy `Product` commerce columns (`sku`, `gtin`, `mpn`, `priceAmount`, `priceCurrency`, `availability`, `category`) are **kept as nullable compatibility columns**. A **conservative, non-destructive backfill** is required for the later migration because database contents are unknown. **No destructive column removal is authorized** by this ADR. |
| D11 | `createProposal` is **not** added in the Google Merchant adapter milestone. |
| D12 | Proposals are **per product/variant offer**, not batches. |
| D13 | PREORDER/BACKORDER mapping is allowed **only when `availabilityDate` exists**. This is a Google Merchant channel rule enforced by that adapter; the canonical model keeps the date nullable. |
| D14 | `amountMicros` is a **JSON string**, computed with **exact BigInt** arithmetic (future mapper). |
| D15 | **Implementation boundary:** this ADR's schema step edits `prisma/schema.prisma` and the canonical Zod schemas only. **No migration is created or applied, and no database is connected to.** A migration is a separate approval. |
| D16 | **`Variant.inventoryQuantity` is nullable:** `null` (in Zod, `undefined`) means **unknown**; `0` means **known zero**. There is **no default**, and 0 is never used as "unknown". |
| D17 | **GTIN:** unique when present. It must be **8, 12, 13, or 14 digits with a valid GS1 check digit** (all-zero values are rejected). It is **never trimmed, stripped, zero-padded, or otherwise rewritten**. |
| D18 | **Family rules** (in `ProductWithVariantsInputSchema`): duplicate `sku` and duplicate non-null `gtin` are rejected; **duplicate non-null color/size combinations are rejected**, compared ignoring case, surrounding spaces, and Unicode composition; a variant with neither color nor size is exempt; all variants of one product must use the **same currency** in v0.1. There is **no database unique on color/size**, because NULLs are distinct in a unique index. |
| D19 | **`compareAtPriceAmount`** is the regular/original price and is valid only when **strictly greater** than `priceAmount`; invalid comparisons are rejected. A future mapper may emit `price` plus `salePrice`. |
| D20 | **An active `Product` cannot have zero variants.** Migration-era `draft` (and `archived`) products may. |
| D21 | **`Product.title` stays canonical.** A future Merchant mapper derives the variant title, including distinguishing color/size attributes. That mapper is not implemented here. |
| D22 | **Typed apparel metadata:** `Product.gender` and `Product.ageGroup` (nullable during migration), `Product.pattern` (nullable, `VarChar(100)`), `Product.sizeSystem` (nullable, `VarChar(8)`, lowercase token), `Product.sizeTypes` (enum array, default empty); `Variant.color` and `Variant.size` (nullable during migration, `VarChar(100)`). |
| D23 | **Validation collects errors** rather than stopping at the first field: every field problem is reported together, and the family rules add their own issues. Cross-field and cross-variant rules run only once fields parsed to their expected types, since they read the parsed values. |

## Reconciliation with the previous schema

"Legacy (deprecated)" means the column stays, becomes nullable, and is not
read by new code once the backfill is verified. It is removed only by a
later, separately approved migration (D10).

| Previous `Product` field | Now | Note |
|---|---|---|
| `id` (cuid) | unchanged | source of `itemGroupId` (D4, D9) |
| `sku` (unique) | `Variant.sku`; `Product.sku` legacy (deprecated) | copied by the backfill |
| — | `Product.handle` (unique) | generic storefront slug; not an identity and not a URL rule |
| `title`, `description`, `brand` | unchanged | |
| `category` | `Product.productType`; `Product.category` legacy | copied by the backfill |
| — | `material`, `condition`, `tags`, `status`, apparel metadata | see D22 |
| `images` | unchanged (shared images) | `Variant.imageUrl` starts empty |
| `gtin`, `mpn` | `Variant.gtin`, `Variant.mpn`; `Product.gtin`/`mpn` legacy (deprecated) | copied |
| `priceAmount`, `priceCurrency` | `Variant.priceAmount`, `Variant.currency`; `Product.priceAmount`/`priceCurrency` legacy (deprecated) | copied |
| `availability` | `Variant.availability`; `Product.availability` legacy (deprecated) | same `Availability` enum, unchanged |
| `attributes` (JSON) | kept, channel-neutral escape hatch (D2) | `color`/`size`/`material` copied to columns when present |
| timestamps | kept on both models | |
| (none — no inventory column) | `Variant.inventoryQuantity`, nullable | backfilled as `NULL` (unknown) |

## Implemented schema (source of truth: `prisma/schema.prisma`)

The Prisma file is authoritative; this summary records intent. It was
formatted, validated, and generated with `prisma format`, `prisma validate`,
and `prisma generate` using only a process-local dummy `DATABASE_URL`.

**Enums added:** `ProductCondition` (`new`, `used`, `refurbished`),
`LifecycleStatus` (`draft`, `active`, `archived`), `Gender` (`male`,
`female`, `unisex`), `AgeGroup` (`newborn`, `infant`, `toddler`, `child`,
`adult`), `SizeType` (`regular`, `petite`, `plus`, `tall`, `maternity`).
`Availability` and the `Proposal*` enums are unchanged.

**`Product`:** the shared fields in D2 and D22, a `Variant[]` relation, and
the nullable legacy compatibility columns in D10. `handle` is unique.

**`Variant`:** the fields in D3, with `sku` unique, `gtin` unique when
present, `currency` `VarChar(3)`, `inventoryQuantity Int?` with no default,
`color`/`size` `VarChar(100)`, and a required `productId` foreign key with
`ON DELETE RESTRICT ON UPDATE CASCADE`.

## Constraints (D-numbers show the source)

"Zod" rules are implemented and tested. "DB `CHECK`" rules are **specified
here but not implemented**: Prisma's schema language cannot express `CHECK`
constraints, so they are hand-written SQL in the future migration. Zod
rules protect only writes that pass through the schemas; direct SQL writes
bypass them, which is acceptable for v0.1.

| Field | Rule | Enforced in |
|---|---|---|
| `Variant.priceAmount` | **positive** integer within Prisma `Int` (`1 … 2,147,483,647` minor units, which is a safe integer) | Zod; DB `CHECK (price_amount > 0)` (specified) |
| `Variant.compareAtPriceAmount` | null, or **strictly greater** than `priceAmount` (D19) | Zod; DB `CHECK (compare_at_price_amount IS NULL OR compare_at_price_amount > price_amount)` (specified) |
| `Variant.inventoryQuantity` | null (unknown) or a non-negative integer (D16) | Zod; DB `CHECK (inventory_quantity IS NULL OR inventory_quantity >= 0)` (specified) |
| `Variant.currency` | exactly three uppercase ASCII letters (D7) | Zod; DB `CHECK (currency ~ '^[A-Z]{3}$')` (specified) |
| `Variant.availabilityDate` | nullable; required for `preorder`/`backorder` only by the Merchant adapter (D13) | Adapter |
| `Variant.sku` | unique; 1–50 characters counted by code point; no `~`, `/`, `%`, whitespace, or control characters | DB unique; Zod; DB `CHECK` (specified) |
| `Variant.gtin` | **nullable uniqueness:** a plain unique index treats every `NULL` as distinct in PostgreSQL, so any number of variants may have no GTIN while two with the same non-null GTIN conflict. Blank strings are invalid (store `NULL`). 8/12/13/14 digits with a valid GS1 check digit; never padded or rewritten (D17) | DB unique; Zod; DB `CHECK` on digit shape (specified) |
| `Variant.mpn` | non-blank, at most 255 characters | Zod |
| `Product.handle` | unique lowercase slug `^[a-z0-9]+(-[a-z0-9]+)*$` | DB unique; Zod |
| `Product`/`Variant` `id` | `cuid()` default; existing ids never change (D9) | DB default |
| `itemGroupId` | **not stored**; `Product.id` verbatim at mapping time (D4) | Adapter |
| Images, `imageUrl` | absolute `http`/`https` only, no embedded credentials, at most 2048 characters | Zod; adapter re-validates |
| `sourceUpdatedAt`, `availabilityDate` | a `Date` or a non-empty parseable string; **`null` is rejected, never turned into the epoch** | Zod |
| Duplicate `sku` / non-null `gtin` in one product | rejected | Zod (`ProductWithVariantsInputSchema`) |
| Duplicate non-null color/size in one product | rejected (D18) | Zod only |
| One currency per product | all variants share it (D18) | Zod only |
| Active product has variants | at least one (D20) | Zod only |
| Product with variants: relation | one `Product` has many `Variant`s; `Variant.productId` required | DB foreign key |

### Deletion policy

The foreign key is **`ON DELETE RESTRICT`, `ON UPDATE CASCADE`**: a
`Product` cannot be deleted while it has variants, and nothing cascades.
Following `CLAUDE.md` (nothing deletes products or history automatically):

- hard deletes are not a supported application operation for either model;
  `archived` is the retirement state, and archiving a `Product` excludes all
  of its variants from mapping;
- `Proposal.targetId` is a plain string, not a foreign key, so a proposal
  does not block a delete; that is why hard deletes are excluded by policy
  (and, later, by database role permissions) rather than by a key.

## Canonical Zod schemas (implemented, `src/lib/schema/`)

| Module | Contents |
|---|---|
| `common.ts` | lowercase enum schemas, `CurrencyCodeSchema`, `HttpUrlSchema`, strict `DateInputSchema` |
| `gtin.ts` | `GtinSchema`, `isValidGtin`, `gtinProblem` (exact-as-supplied validation) |
| `product.ts` | `ProductInputSchema`, `ProductRecordSchema` (adds `id`); legacy commerce columns are not part of the schema and are stripped |
| `variant.ts` | `VariantInputSchema`, `VariantRecordSchema` (adds `id`, `productId`); at least one of `gtin`/`mpn`; `compareAtPriceAmount > priceAmount` |
| `product-with-variants.ts` | `ProductWithVariantsInputSchema` (also exported as `ProductWithVariantsSchema`): the family rules D18, D20 |
| `persistence-boundary.ts` | `nullsToUndefined`, `parseProductRow`, `parseVariantRow` (D6) |
| `proposal.ts` | unchanged |

Product images stay required (at least one shared image), as before.
`gender` and `ageGroup` are optional in Zod because they are nullable in the
database during migration; requiring them later is an explicit follow-up
decision (see "Remaining decisions"). The old "at least one of `gtin`/`mpn`"
rule now lives on `Variant`.

## Merchant identity and field mapping (for the future mapper)

Nothing in this section is implemented. Canonical lowercase values map to
Google's uppercase API values in **explicit, tested adapter tables**
(`in_stock → IN_STOCK`, `new → NEW`, and so on).

| Merchant field | Source |
|---|---|
| `offerId` | `Variant.sku` |
| `itemGroupId` | `Product.id` verbatim, set on every offer so it never changes when a variant is added; never stored |
| `contentLanguage`, `feedLabel` | Merchant channel configuration |
| `link` | storefront-derived adapter context, supplied as a finished URL |
| `title` | derived variant title: `Product.title` plus the distinguishing color/size (D21) |
| `condition` | `Product.condition` through a table |
| `availability`, `availabilityDate` | `Variant`; `preorder`/`backorder` without a date are not mapped (D13) |
| `price` / `salePrice` | `Variant.priceAmount` and `currency` → `amountMicros` (JSON string, exact BigInt). If `compareAtPriceAmount` is present (and greater), `price` is the compare-at value and `salePrice` is `priceAmount` (D19). The adapter supports only `EUR` and `TRY` (D7) |
| `description`, `brand`, `material` | `Product` |
| `gtins`, `mpn`, `color`, `sizes` | `Variant` (`sizes` is the single `size`) |
| `gender`, `ageGroup`, `pattern`, `sizeSystem`, `sizeTypes` | `Product`, through explicit tables |
| `imageLink`, `additionalImageLinks` | `Variant.imageUrl` if set, else the first `Product.images` entry; the rest are additional |

Only offers whose `Product.status` and `Variant.status` are both `active`
are mapped; the adapter never emits a delete proposal. Proposals are per
offer (D12): `targetId` is the `productInputId`, and the unique `sku` maps a
proposal back to its `Variant`.

## Migration and backfill strategy (a separate approval; not part of this change)

**Assumption:** database contents are unknown, so every environment is
treated as possibly containing data. The path is **expand → backfill →
verify → (later) contract**, and it is required even if the project is
believed to be empty: a believed-empty database is not a verified-empty one.

This ADR's implementation created **no migration**. There is no migration
history in the repository, so the first migration will be authored later,
from the accepted schema, as its own approval, and must be hand-written
(Prisma alone would add required columns without a backfill).

### What happens to existing Product values

Nothing is moved or deleted. Every legacy value stays on `Product`, and a
**copy** is written to a new default `Variant`:

| Legacy `Product` value | Copied to | Note |
|---|---|---|
| `sku` | `Variant.sku` | unique already |
| `gtin`, `mpn` | `Variant.gtin`, `Variant.mpn` | copied verbatim; blank strings become `NULL`; malformed, checksum-failing, or cross-product duplicate GTINs are **reported**, not fixed or padded |
| `priceAmount` | `Variant.priceAmount` | rows that break the new `> 0` rule are listed for a human |
| `priceCurrency` | `Variant.currency` | must already be three uppercase ASCII letters; violations are listed, **not** auto-corrected |
| `availability` | `Variant.availability` | same enum, values as they are |
| *(no inventory column)* | `Variant.inventoryQuantity = NULL` | **unknown**, never `0` (D16) |
| `images` | stays on `Product.images` | `Variant.imageUrl` starts `NULL` |
| `attributes.color`, `.size`, `.material` | `Variant.color`, `Variant.size`, `Product.material` | copied when present; `attributes` is kept |
| `category` | `Product.productType` | copied; `category` is kept |
| — | `Product.handle` | slug of the title plus a short id suffix; collisions reported |
| — | `Product.condition = new`; `Product.status`, `Variant.status = draft` | nothing reaches a feed until a human activates it |
| — | `gender`, `ageGroup`, `pattern`, `sizeSystem`, `color`, `size` | `NULL` unless derivable from `attributes`; `sizeTypes` empty |

`Product.id` and `Product.sku` are never rewritten; `compareAtPriceAmount`
and `availabilityDate` start `NULL`. Backfilled `preorder`/`backorder`
variants cannot be mapped to Merchant until a human supplies a date (D13).

### Steps

1. **Expand (additive or loosening only).** Create the new enums and the
   `Variant` table; add the new `Product` columns (`handle` and
   `productType` first nullable); make the legacy offer-level `Product`
   columns nullable. No existing enum is altered, no id is touched, and
   nothing is dropped, truncated, or rewritten.
2. **Backfill,** in a transaction, first against a **copy** of the data: one
   default `Variant` per `Product` (its `productId` set to that
   `Product.id`, a new cuid as its id), filled per the table above; then set
   `handle` and `productType` to `NOT NULL`.
3. **Verify** (all must pass; results recorded in the PR):
   - `count(Product) = count(Variant)` and each `Product` has exactly one
     default `Variant`;
   - a field-by-field comparison of `sku`, `gtin`, `mpn`, `priceAmount`,
     `priceCurrency` → `currency`, `availability`, and `category` →
     `productType` returns **zero** mismatches;
   - `handle`, `sku`, and non-null `gtin` are unique;
   - every `currency` matches `^[A-Z]{3}$`;
   - rows that would break the new rules (price `<= 0`, malformed or
     duplicate GTIN, non-uppercase currency) are reviewed and fixed **by a
     human**, and only then are the `CHECK` constraints and the `gtin`
     unique index added (first as `NOT VALID`, then `VALIDATE`).
4. **Switch reads.** Application code reads only `Variant` and the new
   `Product` columns; a guard fails if code reads a deprecated legacy column.
5. **Contract, later, only with separate approval.** Removing the legacy
   columns needs verification passed, at least one release with no reads of
   them, a fresh backup, and an explicit human approval. **Not authorized
   here.**

Until step 5 nothing is destroyed, so the new table and columns can be
dropped with no data loss. If a database turns out to be empty, the steps
are still followed; collapsing them would need a human to verify emptiness
and approve that explicitly.

## Relationship to ADR 0001

ADR 0001's statement that `priceAmount` is "decimal in the Zod/API layer"
was wrong: the implementation always stored and validated **integer minor
units** (Prisma `Int`, Zod `z.number().int()`). That is corrected **through
this ADR** (D5) and is not rewritten in ADR 0001's body. A minimal
cross-reference at the top of ADR 0001 points readers here, because ADR 0001
otherwise contains a statement that is now known to be wrong.

Where this ADR and ADR 0001 differ, this ADR governs: `Product` is split into
`Product` and `Variant`, and the "at least one of `gtin`/`mpn`" rule moves to
`Variant`. ADR 0001's principles remain: canonical data is the source of
truth, adapters map from it and never own fields, and all external data is
validated with Zod at the boundary.

## Resolution of proposals P1–P13

| # | Proposal | Outcome |
|---|---|---|
| P1 | `itemGroupId = Product.id` verbatim | **Accepted** (D4). Because it is never stored, an adapter could later prefix or hash it without a schema change. |
| P2 | Keep `Product.attributes` as an escape hatch | **Accepted**, as a **channel-neutral** escape hatch; not for advertising-platform keys (D2). |
| P3 | Lifecycle values `draft`, `active`, `archived`; backfilled records start `draft` | **Accepted** (D8, migration table). |
| P4 | `ProductCondition` `new`, `used`, `refurbished` | **Accepted**. |
| P5 | Additive renames (`productType` from `category`, `currency` from `priceCurrency`) | **Accepted**; legacy columns are kept (D10). |
| P6 | `Variant.gtin` unique when present | **Accepted, with detail:** checksum-validated 8/12/13/14 digits, never padded or rewritten (D17). |
| P7 | Inventory/availability consistency is advisory only | **Accepted, with a correction:** never a Zod error; a future adapter warning. Unknown inventory is `NULL`, **not** `0` (D16). |
| P8 | Primary image is the variant image if present, else the first shared image | **Accepted** (mapping table). |
| P9 | Keep the three timestamps on both models | **Accepted**. |
| P10 | Keep Prisma `Int` for prices | **Accepted** (D5): integer minor units for v0.1, with the 32-bit limit stated. |
| P11 | No DB unique on `(productId, color, size)`; adapter warning | **Superseded:** still **no database unique**, but duplicate non-null color/size combinations are **rejected by Zod**, not merely warned about (D18). |
| P12 | Merchant `title` is `Product.title` unchanged | **Superseded:** `Product.title` stays canonical, and the future mapper **derives a variant title** with color/size (D21). |
| P13 | `CHECK` constraints added `NOT VALID`, then `VALIDATE`d | **Accepted** (migration step 3). |

## Resolution of open questions OQ1–OQ7

| # | Question | Resolution |
|---|---|---|
| OQ1 | Apparel attributes Merchant may require | **Resolved:** typed, channel-neutral fields added (D22): `gender`, `ageGroup`, `pattern`, `sizeSystem`, `sizeTypes` on `Product`; `color` and `size` on `Variant`. Google spellings are not copied into the model. |
| OQ2 | `compareAtPriceAmount` and Merchant sale price | **Resolved (D19):** `compareAtPriceAmount` is the regular price only when greater than `priceAmount`; a future mapper may emit `price` plus `salePrice`; invalid comparisons are rejected. |
| OQ3 | Composed variant title | **Resolved (D21):** `Product.title` stays canonical; a future mapper derives the variant title. Not implemented. |
| OQ4 | Mixed currencies within a product | **Resolved (D18):** not allowed in v0.1; rejected by Zod. |
| OQ5 | Storefront link resolver | **Resolved for now (D4):** storefront URLs remain adapter context; no Shopify-specific ids or URL rules are added. |
| OQ6 | Whether any database holds `Product` rows | **Unknown and left unknown.** No claim is made either way. The conservative backfill applies regardless, and a human must verify database contents before any migration is authored or applied. |
| OQ7 | GTIN normalization | **Resolved (D17):** no normalization, padding, or rewriting. Padding-equivalent GTINs (for example a GTIN-12 and its zero-padded GTIN-13) are distinct strings and are not detected as duplicates; this is an accepted limitation. |

## Alternatives considered

- **A. Adapter-level variant context:** rejected. Size, color, SKU, price, and
  inventory are domain data for an apparel business; keeping the family in
  the Google adapter would leave the canonical model unable to describe its
  own catalog.
- **B. Nullable grouping fields on a flat `Product`:** rejected. Every
  variant row would duplicate parent data, nothing would enforce that
  siblings agree, and there would be no home for family-level data.
- **C′. A `Currency` Prisma enum limited to EUR and TRY:** rejected (D7).
  Every new currency would need a database migration, and the canonical model
  would be limited by one channel's supported set.
- **D. Converting ids to UUID or renaming existing enums to uppercase:**
  rejected (D8, D9). The repository already uses `cuid()` ids and lowercase
  enums; changing either would add migration risk with no benefit.
- **E. A database unique on `(productId, color, size)`:** rejected (D18).
  NULLs are distinct in a unique index, so it would not catch the cases that
  matter, and it would fail for variants that legitimately lack color or size
  during migration.
- **F. Defaulting `inventoryQuantity` to 0:** rejected (D16). It would turn
  "unknown" into "out of stock".

## Consequences

- One canonical place for catalog structure; a future adapter reads `Product`
  plus `Variant` instead of guessing.
- Breaking changes to the canonical Zod schemas and their tests. Existing
  enums, existing ids, and the `Proposal*` schemas are unchanged.
- The schema in `prisma/schema.prisma` is the expand-phase target and is
  **not migratable as-is**: required columns (`handle`, `productType`) have
  no defaults, so the migration must be hand-written to add, backfill, and
  then enforce them. Running an automatic migration against a database that
  has rows would fail rather than silently lose data.
- The backfill and verification add real work even if no rows exist.
- Several rules (duplicates, single currency, active-needs-variant) are
  enforced only by Zod, so they protect only writes that go through the
  schemas.
- A price is capped at `Int` range: 21,474,836.47 in a two-digit currency.
- ADR 0002 is unaffected; only the `after` payload and `targetId` differ.

## Remaining decisions (not blocking this ADR)

- **Requiring apparel metadata:** whether `gender`, `ageGroup`, `color`, and
  `size` become required for `active` products once migration is complete.
  They are optional today only because the database columns are nullable
  during migration.
- **Archived variants:** the duplicate color/size and duplicate `sku`/`gtin`
  checks apply to all variants regardless of status, which is conservative
  and may need relaxing for retained archived variants.
- **Size vocabularies:** the `SizeType` members and the `sizeSystem` token
  set are a v0.1 starting point; changing an enum needs a migration, while
  `sizeSystem` (a bounded string) does not.
- **Migration authoring:** hand-written SQL, verified against a copy of real
  data, is a separate approval and depends on the answer to OQ6.
- **Live-account questions** (Merchant Center roles, data-source creation,
  consent-screen status, quotas) remain in
  `docs/plans/google-merchant-adapter.md` §13.C and do not affect this ADR.
