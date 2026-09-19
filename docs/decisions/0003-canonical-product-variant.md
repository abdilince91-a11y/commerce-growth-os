# ADR 0003: Canonical Product and Variant model

Status: **Proposed** (not Accepted; nothing in this ADR is implemented)
Date: 2026-09-20 · Revised after two owner reviews (same day)
Amends: ADR 0001 (canonical product schema) if and when accepted
Related: ADR 0002 (approval gate), `docs/plans/google-merchant-adapter.md` (Slice 0)

## Context

ONOE is an apparel business. Size, color, SKU, price, inventory, and the
relationship between a product and its variants are **domain data**, not
Google-specific adapter context. The current canonical schema (ADR 0001)
has a single flat `Product` carrying one `sku`, one price, one
availability, and a free-form `attributes` JSON. It cannot represent a
product family (one shirt in five sizes and three colors) without
duplicating parent data on every row.

The Google Merchant adapter needs two stable identities: an offer identity
(one per purchasable SKU) and a group identity (the family). Deciding this
after the mapper is written would mean rework, so it is decided first.

### Verified facts about the repository (2026-09-20)

Only facts that were actually checked are recorded here.

- `prisma/schema.prisma` defines `Product` and `Proposal`; there is no
  `Variant` model.
- There is no `prisma/migrations` directory in the repository.
- No database was connected to or inspected while preparing this ADR.
  Therefore **whether any environment already holds `Product` rows is
  unknown** (Open Question OQ6).
- `Product.id` and `Proposal.id` are declared `@default(cuid())`. ADR 0001
  documents `id` as `string (cuid)`.
- Every existing Prisma enum uses **lowercase** values: `Availability`
  (`in_stock`, `out_of_stock`, `preorder`, `backorder`), `ProposalType`
  (for example `feed_update`), `ProposalStatus` (for example `pending`),
  and `ProposalCreatedBy`.
- The legacy `Product` has `sku`, `gtin`, `mpn`, `priceAmount`,
  `priceCurrency`, `availability`, `category`, `images`, and `attributes`.
  It has **no inventory column**.

### Repository conventions this ADR follows

Where an earlier instruction assumed something different, the repository
wins.

| Topic | Convention preserved |
|---|---|
| Identifiers | Existing `Product.id` and `Proposal.id` stay `cuid()`; **no id conversion is proposed**. New `Variant.id` also uses `cuid()`. |
| Enums | New canonical enums use **lowercase** values, like the existing ones. Existing enums are not changed for naming style. |
| Inventory | Nothing to copy: no inventory column exists today. |

## Decisions

Decisions D1–D7 and D11–D15 were made by the product owner. D8–D10 were
set in the owner's second review, where the repository conventions above
took precedence over earlier assumptions.

| # | Decision |
|---|---|
| D1 | **Option C:** introduce a first-class canonical `Variant` model. |
| D2 | `Product` remains the parent and owns shared data: `id`, `handle`, `title`, `description`, `brand`, `productType`, `material`, `condition` (default `new`), shared `images`, `tags`, lifecycle `status`, timestamps. |
| D3 | `Variant` owns: `id`, `productId`, `sku` (unique), `gtin` (nullable), `mpn` (nullable), `priceAmount` (integer minor units), `compareAtPriceAmount` (nullable), `currency`, `inventoryQuantity`, `availability`, `availabilityDate` (nullable), `color` (nullable), `size` (nullable), a variant-specific image URL (nullable), lifecycle `status`, timestamps. |
| D4 | **Merchant identity:** `offerId` derives from `Variant.sku`. `itemGroupId` derives deterministically from `Product.id` **at mapping time and is not stored** as duplicated canonical data. `contentLanguage` and `feedLabel` are Merchant channel configuration. Landing-page URLs are storefront-derived context. `condition` is canonical `Product` data. `availability` and `availabilityDate` are canonical `Variant` data. |
| D5 | `priceAmount` is **integer minor units**. ADR 0001 wrongly says "decimal in the Zod/API layer"; the corrected wording is given below and is applied to ADR 0001 only if this ADR is accepted (ADR 0001 is not edited by this proposal). |
| D6 | `null → undefined` normalization stays at the **adapter boundary**; canonical Zod schemas are not loosened to accept `null`. |
| D7 | **Currency:** canonical database field `currency String @db.VarChar(3)`; canonical validation is an **uppercase three-letter ISO 4217-shaped** string (`^[A-Z]{3}$`, shape only, not membership in the ISO list); the **Google Merchant adapter v0.1 allowlist is exactly `EUR` and `TRY`**, and anything else returns `unsupported_currency`. **No Prisma currency enum.** Adding a currency is an adapter change, never a database migration. |
| D8 | **Enum convention: lowercase, matching the repository.** New canonical enums: `LifecycleStatus` (`draft`, `active`, `archived`) and `ProductCondition` (`new`, `used`, `refurbished`). The existing `Availability` enum (`in_stock`, `out_of_stock`, `preorder`, `backorder`) is reused **unchanged**, and no existing enum is renamed or altered for style. The Merchant adapter maps canonical lowercase values to Google's uppercase API enums in explicit tables. |
| D9 | **Identifiers are preserved.** `Product.id` and `Proposal.id` stay `cuid()` and every existing id stays unchanged; **no UUID conversion is proposed or justified**. `Variant.id` is `@default(cuid())` for consistency. `Product.id` is the stable source of the derived `itemGroupId`; `Variant.sku` (unique) is the source of `offerId`. A cuid is a short string, well under Merchant's 50-character id limit, and never changes, which is what a deterministic identifier needs. |
| D10 | **Existing data:** a **conservative, non-destructive backfill is required, even if the project is believed to be empty**, because emptiness is unverified. Create one default `Variant` per existing `Product`, copy the offer-level values into it, verify, and only then consider removing the duplicated `Product` columns in a **later, separately approved** migration. **No destructive column removal is authorized in Slice 0.** |
| D11 | `createProposal` is **not** added in the Google Merchant adapter milestone. |
| D12 | Proposals are **per product/variant offer**, not batches. |
| D13 | PREORDER/BACKORDER mapping is allowed **only when the required `availabilityDate` exists**. |
| D14 | `amountMicros` is a **JSON string**, computed with **exact BigInt** arithmetic. |
| D15 | **Migration boundary:** this ADR proposes Prisma and Zod changes, constraints, and a migration strategy. It edits no schema, Zod file, or migration and connects to no database. Implementation requires a **separately approved schema step** after this ADR is reviewed and accepted. |

## Reconciliation with the current schema

"Keep (deprecated)" means the column stays, becomes nullable, and is no
longer read by new code once the backfill is verified. It is removed only
by a later, separately approved contract migration (D10). No existing
`Product` field is removed by this ADR.

| Current `Product` field | Proposed | Note |
|---|---|---|
| `id` (cuid) | **unchanged** | stable source of `itemGroupId` (D9) |
| `sku` (unique) | **add** `Variant.sku`; keep `Product.sku` (deprecated) | copied by the backfill |
| — | **add** `Product.handle` (unique) | storefront slug; used to build landing-page URLs, never as an identity |
| `title`, `description`, `brand` | keep | |
| `category` | **add** `productType`; keep `category` (deprecated) | copied by the backfill; same meaning ("internal taxonomy") |
| — | **add** `material`, `condition`, `tags`, `status` | |
| `images` | keep (shared images) | nothing to copy; `Variant.imageUrl` starts empty |
| `gtin`, `mpn` | **add** to `Variant`; keep on `Product` (deprecated) | copied |
| `priceAmount`, `priceCurrency` | **add** `Variant.priceAmount`, `Variant.currency`; keep on `Product` (deprecated) | copied |
| `availability` | **add** `Variant.availability`; keep on `Product` (deprecated) | copied; the `Availability` enum is **unchanged** |
| `attributes` (JSON) | keep (P2) | `color`/`size`/`material` are copied into columns when present |
| `sourceUpdatedAt`, `canonicalUpdatedAt`, `createdAt` | keep on both models (P9) | |
| (none — no inventory column exists) | **add** `Variant.inventoryQuantity`, default `0` | `0` means unknown for backfilled rows |

New on `Variant`: `productId`, `compareAtPriceAmount`, `inventoryQuantity`,
`availabilityDate`, `color`, `size`, `imageUrl`, `status`.

## Proposed Prisma models (not applied)

Both blocks below were validated offline as scratch files with
`prisma validate` and a process-only dummy `DATABASE_URL` (no database
connection, no repository edit). `prisma/schema.prisma` is unchanged.

### Target schema (after a later, separately approved contract migration)

`Availability` and `Proposal` are unchanged and omitted.

```prisma
enum ProductCondition { new  used  refurbished }
enum LifecycleStatus  { draft  active  archived }

model Product {
  id                 String           @id @default(cuid())
  handle             String           @unique
  title              String
  description        String
  brand              String?
  productType        String
  material           String?
  condition          ProductCondition @default(new)
  images             String[]
  tags               String[]
  attributes         Json             @default("{}")
  status             LifecycleStatus  @default(draft)
  sourceUpdatedAt    DateTime
  canonicalUpdatedAt DateTime         @updatedAt
  createdAt          DateTime         @default(now())
  variants           Variant[]

  @@index([status])
  @@index([productType])
}

model Variant {
  id                   String          @id @default(cuid())
  productId            String
  product              Product         @relation(fields: [productId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  sku                  String          @unique
  gtin                 String?         @unique
  mpn                  String?
  priceAmount          Int
  compareAtPriceAmount Int?
  currency             String          @db.VarChar(3)
  inventoryQuantity    Int             @default(0)
  availability         Availability
  availabilityDate     DateTime?
  color                String?
  size                 String?
  imageUrl             String?
  status               LifecycleStatus @default(draft)
  sourceUpdatedAt      DateTime
  canonicalUpdatedAt   DateTime        @updatedAt
  createdAt            DateTime        @default(now())

  @@index([productId])
  @@index([status])
}
```

### Expand-phase difference (what the first implementation migration would apply)

The expand-phase `Product` is the target `Product` **plus** the legacy
offer-level columns, kept nullable and deprecated:

```prisma
  // legacy, deprecated, nullable — removed only by a later approved migration
  sku           String?       @unique
  gtin          String?
  mpn           String?
  priceAmount   Int?
  priceCurrency String?
  availability  Availability?
  category      String?
```

`Variant` and everything else are identical to the target schema.

## Database constraints and indexes (documented, not implemented)

Prisma's schema language cannot express `CHECK` constraints, so those are
hand-written SQL appended to the migration when it is authored (separate
approval). Prisma does not track them, so they are reviewed by hand.
"Enforced in" shows the layer that must reject bad data.

### Price, inventory, and availability

| Field | Rule | Enforced in |
|---|---|---|
| `Variant.priceAmount` | **positive** (`> 0`) and safe for the selected representation: a Prisma `Int` is a 32-bit PostgreSQL `INTEGER`, so `1 … 2,147,483,647` minor units (21,474,836.47 in a two-digit currency). Zod also requires `Number.isSafeInteger`. | DB `CHECK (price_amount > 0)` + Zod `.int().positive().max(2147483647)` |
| `Variant.compareAtPriceAmount` | null, or **`>= priceAmount`** | DB `CHECK (compare_at_price_amount IS NULL OR compare_at_price_amount >= price_amount)` + Zod |
| `Variant.inventoryQuantity` | **non-negative** integer, not null, default `0` | DB `CHECK (inventory_quantity >= 0)` + Zod `.int().nonnegative()` |
| `Variant.availabilityDate` | nullable in the canonical model. **Required for `preorder`/`backorder` only when the channel requires it.** Google Merchant does, so the Merchant adapter refuses to map such an offer without a date (D13). No DB `CHECK` and no canonical Zod rule forces it, so other channels are not constrained. | Adapter, driven by channel configuration |
| `Variant.currency` | `VarChar(3)`; uppercase three letters | DB `CHECK (currency ~ '^[A-Z]{3}$')` + Zod `^[A-Z]{3}$`; the supported set is enforced by the Merchant adapter (D7) |

### Identity, uniqueness, and text

| Field | Rule | Enforced in |
|---|---|---|
| `Variant.sku` | unique; 1–50 characters; no `~`, `/`, `%`, whitespace, or control characters | DB unique + DB `CHECK` + Zod + adapter |
| `Variant.gtin` | **nullable uniqueness:** a plain unique index on a nullable column treats every `NULL` as distinct in PostgreSQL, so **any number of variants may have no GTIN**, while two variants with the *same non-null* GTIN conflict. An empty string is not `NULL`, so blank values must be stored as `NULL` (`CHECK (gtin <> '')`). Uniqueness is on the exact stored text: `012345678905` and `0012345678905` name the same trade item but are **not** detected as duplicates (OQ7). Digits only, length 8/12/13/14; checksum validated in Zod and the adapter. | DB unique + DB `CHECK` on shape; checksum in Zod + adapter |
| `Variant.mpn` | non-empty when present | Zod (length limit unverified) |
| `Product.handle` | unique; lowercase slug `^[a-z0-9]+(-[a-z0-9]+)*$` | DB unique + Zod |
| `Product.id`, `Variant.id` | `cuid()` default; existing ids never change (D9) | DB default |
| `itemGroupId` | **not stored**; derived from `Product.id` at mapping time (D4) | Adapter |
| `(productId, color, size)` | no two variants of one product with the same color and size | Zod + adapter warning (`variant_not_distinguishable`); no DB unique, because `NULL`s are distinct (P11) |

### Product 1:N Variant relation and deletion policy

- One `Product` has many `Variant`s; each `Variant` belongs to exactly one
  `Product` (`Variant.productId` is required).
- Foreign key: **`ON DELETE RESTRICT`, `ON UPDATE CASCADE`**. A `Product`
  cannot be deleted while it has variants, and nothing cascades. Two
  further consequences of the same `CLAUDE.md` rule (nothing deletes
  products or history automatically):
  - **hard deletes are not a supported application operation** for either
    model; `archived` is the retirement state;
  - archiving a `Product` excludes all of its variants from mapping.
- A `Product` may have zero variants only while `draft`; the database
  cannot enforce "at least one variant", so the application does.
- `Proposal.targetId` is a plain string, not a foreign key, so a proposal
  does not block a delete. That is why hard deletes are excluded by policy
  (and, later, by database role permissions) rather than by a key.

### Statuses and enums

`Product.status` and `Variant.status` are not null and default to
`draft`; `Product.condition` is not null and defaults to `new`;
`Variant.availability` is not null with no default. All enum values are
lowercase (D8).

### Indexes

Unique on `Product.handle`, `Variant.sku`, and `Variant.gtin`; plain
indexes on `Product.status`, `Product.productType`, `Variant.productId`
(load a product's variants), and `Variant.status` (select active offers).
`sku` lookup is the hot path because every mapped offer is keyed by it.

## Proposed Zod changes (not applied)

In `src/lib/schema/product.ts`, plus `product.test.ts`:

- The existing `AvailabilitySchema` keeps its lowercase values
  **unchanged**. Add `ProductConditionSchema` (`new`, `used`,
  `refurbished`) and `LifecycleStatusSchema` (`draft`, `active`,
  `archived`), all lowercase.
- `CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/)`: ISO 4217-shaped
  only. **No** `z.enum(["EUR","TRY"])` in the canonical schema (D7); the
  supported set lives in the Merchant adapter.
- Add `HttpUrlSchema`: `z.string().url()` refined to `http`/`https` with
  no embedded credentials (the current `z.string().url()` accepts
  `javascript:` and `data:` URLs, verified).
- `ProductInputSchema` becomes the parent shape: `handle`, `title`,
  `description`, `brand?`, `productType`, `material?`, `condition`
  (default `"new"`), `images`, `tags`, `status` (default `"draft"`),
  `attributes`, `sourceUpdatedAt`. `sku`, `gtin`, `mpn`, price,
  currency, availability, and the gtin/mpn refinement move out.
- Add `VariantInputSchema`: `sku`, `gtin?`, `mpn?`, `priceAmount`
  (`.int().positive().max(2147483647)`), `compareAtPriceAmount?`
  (`>= priceAmount`), `currency`, `inventoryQuantity`, `availability`,
  `availabilityDate?`, `color?`, `size?`, `imageUrl?`, `status`,
  `sourceUpdatedAt`. Refinement: at least one of `gtin`/`mpn`.
  **No** availability-date rule here: it is a channel requirement (D13).
- Add `ProductWithVariantsInputSchema`: `{ product, variants[] }` with
  unique `sku` and unique `(color, size)` within the array.
- Do **not** add `.nullish()` to accept database `null`s (D6).

The existing tests are rewritten around the two schemas; the gtin/mpn,
no-images, and defaults cases carry over. `Proposal*` schemas and enum
values are untouched.

## Merchant identity and field mapping

Canonical lowercase values are mapped to Google's uppercase API values by
**explicit tables in the adapter** (D8). Each table is tested for
completeness: every canonical member has an entry, and no other value is
accepted.

| Canonical (lowercase) | Merchant API |
|---|---|
| `availability`: `in_stock`, `out_of_stock`, `preorder`, `backorder` | `IN_STOCK`, `OUT_OF_STOCK`, `PREORDER`, `BACKORDER` |
| `condition`: `new`, `used`, `refurbished` | `NEW`, `USED`, `REFURBISHED` |

| Merchant field | Source |
|---|---|
| `offerId` | `Variant.sku` (D4) |
| `itemGroupId` | derived from `Product.id` (P1); set on every offer so it never changes when a second variant is added; never stored |
| `contentLanguage`, `feedLabel` | Merchant channel configuration, not product data |
| `link` | storefront-derived context: a finished URL from a storefront link resolver using `Product.handle` and the variant. The adapter does not own the URL template |
| `condition` | `Product.condition`, through the table above |
| `availability`, `availabilityDate` | `Variant`; `preorder`/`backorder` offers with no `availabilityDate` are **not mapped** and return `missing_availability_date` (D13) |
| `price` | `Variant.priceAmount` + `Variant.currency` → `amountMicros` as a JSON **string**, exact BigInt (D14). The adapter supports only `EUR` and `TRY`, both two minor-unit digits; other currencies return `unsupported_currency` (D7) |
| `title`, `description`, `brand`, `material` | `Product` |
| `gtins`, `mpn`, `color`, `sizes` | `Variant` (`sizes` is the single `size`) |
| `imageLink` | `Variant.imageUrl` if set, else the first `Product.images` entry (P8) |
| `additionalImageLinks` | remaining `Product.images` (P8) |

Only offers whose `Product.status` and `Variant.status` are both `active`
are mapped. `draft` and `archived` records are skipped, and the adapter
never emits a delete proposal; deletion is out of scope (`CLAUDE.md`).

Proposals stay per offer (D12): `targetId` is the `productInputId`
(`contentLanguage~feedLabel~sku`), and the unique `sku` maps each proposal
back to its `Variant`. No `createProposal` is added in this milestone (D11).

## Migration and backfill strategy (proposed; separate approval required)

**Assumption:** because the presence of `Product` rows is unknown
(OQ6), every environment is treated as possibly containing data. The path
is expand → backfill → verify → (later) contract, and it is required
**even if the project is believed to be empty**: a believed-empty
database is not a verified-empty one.

This ADR authorizes **no** migration, **no** schema edit, and **no** column
removal. There is no migration history in the repository to preserve, so
the first migration is authored later, from the approved schema, as its own
approval. Implementation requires a separately approved schema step.

### What happens to existing Product values

Nothing is moved or deleted. Every legacy offer-level value stays on
`Product`, and a **copy** is written to a new default `Variant`:

| Legacy `Product` value | Copied to | Note |
|---|---|---|
| `sku` | `Variant.sku` | unique already, so uniqueness carries over |
| `gtin`, `mpn` | `Variant.gtin`, `Variant.mpn` | copied verbatim; blank strings become `NULL`; invalid values are reported, not silently fixed |
| `priceAmount` | `Variant.priceAmount` | offenders of the new `> 0` rule are listed for a human |
| `priceCurrency` | `Variant.currency` | must already be three uppercase letters; violations are listed, **not** auto-corrected |
| `availability` | `Variant.availability` | same `Availability` enum, values copied as they are |
| *(no inventory column)* | `Variant.inventoryQuantity = 0` | means **unknown**, not out of stock; availability stays authoritative (P7) |
| `images` | stays on `Product.images` | shared images already; `Variant.imageUrl` starts `NULL`, so the adapter falls back to `Product.images[0]` |
| `attributes.color`, `.size`, `.material` | `Variant.color`, `Variant.size`, `Product.material` | copied when present; `attributes` itself is kept |
| `category` | `Product.productType` | copied; `category` is kept |
| — | `Product.handle` | slug of the title plus a short id suffix so it is unique; collisions reported |
| — | `Product.condition = new` | default |
| — | `Product.status`, `Variant.status = draft` | so nothing reaches a feed until a human activates it (P3) |

`Product.id` and `Product.sku` values are never rewritten, and
`Variant.compareAtPriceAmount` and `availabilityDate` start `NULL`.
Backfilled `preorder`/`backorder` variants therefore cannot be mapped to
Merchant until a human supplies a date (D13).

### Steps

1. **Expand (additive or loosening only).**
   - Create the `ProductCondition` and `LifecycleStatus` enums and the
     `Variant` table; add the new `Product` columns (`handle` nullable at
     first).
   - Make the legacy `Product` offer-level columns **nullable** so
     products created afterwards do not need them.
   - No existing enum is altered, no existing id is touched, and nothing
     is dropped, truncated, or rewritten.
2. **Backfill,** in a transaction, first against a **copy** of the data.
   Create exactly one default `Variant` per `Product`, with
   `Variant.productId` set to that `Product.id` and a new cuid as its id,
   and fill the columns per the table above; then set `Product.handle` to
   `NOT NULL` and unique.
3. **Verify** (all must pass; results recorded in the PR):
   - `count(Product) = count(Variant)` and every `Product` has exactly
     one default `Variant`;
   - a field-by-field comparison of `sku`, `gtin`, `mpn`, `priceAmount`,
     `priceCurrency` → `currency`, `availability`, and `category` →
     `productType` returns **zero** mismatches;
   - `handle`, `sku`, and non-null `gtin` are unique;
   - every `currency` matches `^[A-Z]{3}$`;
   - a listing of rows that would violate the new rules (price `<= 0`,
     malformed GTIN, non-uppercase currency) is reviewed and fixed **by a
     human**, and only then are the `CHECK` constraints added (first as
     `NOT VALID`, then `VALIDATE`, P13).
4. **Switch reads.** Application code (including the adapter) reads only
   `Variant` and the new `Product` columns. A guard (lint or test) fails if
   code reads a deprecated legacy column.
5. **Contract, later, only with separate approval.** Removing the
   duplicated `Product` columns needs all of: verification passed, at
   least one release with no reads of the legacy columns, a fresh backup,
   and an explicit human approval. **Not authorized by this ADR or by
   Slice 0.**

### Reversibility

Until step 5, nothing is destroyed: the legacy columns still hold the
original values, so the new table and columns can be dropped with no data
loss.

### If the project turns out to be empty

The backfill then inserts nothing and verification passes trivially. The
steps are still followed; collapsing expand and contract into one
migration would need a human to verify emptiness and approve that change
explicitly.

## Relationship to ADR 0001

- **Not edited by this proposal.** ADR 0001 remains as committed. If this
  ADR is accepted, ADR 0001 is amended in the same change with:
  > Amendment: `priceAmount` is **integer minor units** in the database
  > (Prisma `Int`), the Zod layer (`z.number().int()`), and the API layer.
  > The earlier "decimal in the Zod/API layer" wording was incorrect.
- If accepted, the Product/Variant split supersedes ADR 0001's
  single-table field list. Its principles remain: canonical data is the
  source of truth, adapters map from it and never own fields, and all
  external data is validated with Zod at the boundary.
- The "at least one of `gtin`/`mpn`" rule moves from `Product` to `Variant`.

## Alternatives considered

- **A. Adapter-level variant context:** rejected. Size, color, SKU, price,
  and inventory are domain data for an apparel business; keeping the
  family in the Google adapter would leave the canonical model unable to
  describe its own catalog.
- **B. Nullable grouping fields on a flat `Product`:** rejected. Every
  variant row would duplicate parent data (title, description, images),
  nothing would enforce that siblings agree, and there would be no home
  for family-level data.
- **C′. A `Currency` Prisma enum limited to EUR and TRY:** rejected (D7).
  Every new currency would need a database migration, and the canonical
  model would be limited by one channel's supported set.
- **D. Converting ids to UUID or renaming existing enums to uppercase:**
  rejected (D8, D9). The repository already uses `cuid()` ids and
  lowercase enums; changing either would add migration risk with no
  benefit, since a cuid is a valid deterministic Merchant identifier.

## Consequences

- One canonical place for catalog structure; the adapter reads `Product`
  plus `Variant` instead of guessing.
- Breaking changes to the canonical schema, Zod, and tests. Existing
  enums, existing ids, and the `Proposal*` schemas are unchanged.
- The backfill and verification add real work even if the project is
  empty.
- Batch mapping loads variants per product and groups by product.
- A price is capped at `Int` range (P10).
- ADR 0002 is unaffected; only the `after` payload and `targetId` differ.

## Proposals for review (not decided by the product owner)

Each has a stated default and can be overridden at review.

| # | Proposal |
|---|---|
| P1 | `itemGroupId = Product.id` verbatim (a short cuid, under the 50-character limit). Because it is never stored, a prefixed or hashed form can be introduced in the adapter later with no schema change. |
| P2 | Keep `Product.attributes` (JSON) as an escape hatch for product-level attributes not yet modeled. |
| P3 | `LifecycleStatus` values `draft`, `active`, `archived`; `archived` is the retirement state. Backfilled records start `draft`, so nothing enters a feed until a human activates it. |
| P4 | `ProductCondition` values `new`, `used`, `refurbished`. |
| P5 | Renames are done additively: `productType` is added and copied from `category`; `currency` is added and copied from `priceCurrency`. |
| P6 | `Variant.gtin` is unique when present (see the nullable-uniqueness note). |
| P7 | Inventory/availability consistency is **advisory only**: a Zod/adapter *warning* (for example `in_stock` with quantity `0`), never an error. Backfilled variants have quantity `0` meaning unknown, and preorder/backorder cannot be derived from quantity. |
| P8 | Primary image is the variant image if present, else the first shared image; the rest are additional images. |
| P9 | Keep `sourceUpdatedAt`, `canonicalUpdatedAt`, and `createdAt` on both models, as in ADR 0001. |
| P10 | Keep Prisma `Int` for prices (no `BigInt`); the cap is 21,474,836.47 in a two-digit currency. |
| P11 | No DB unique on `(productId, color, size)`; enforced in Zod and as an adapter warning. |
| P12 | Merchant `title` is `Product.title` unchanged; color and size are sent as their own attributes. |
| P13 | New `CHECK` constraints are added `NOT VALID` and then `VALIDATE`d after a human has fixed any offending legacy rows. |

## Open questions

| # | Question |
|---|---|
| OQ1 | Merchant's apparel rules may require attributes this ADR does not model (for example gender, age group, size system/type, pattern). Where do they live: Product columns, `attributes`, or a later ADR? Not yet verified against Google's specification. |
| OQ2 | If `compareAtPriceAmount` exists, should Merchant `price` be the compare-at value with `salePrice` set to `priceAmount`? Default: ignore it in v0.1. |
| OQ3 | Should variant offers use a composed title (title + color + size)? Default: no (P12). |
| OQ4 | May variants of one product ever use different currencies? Default: allowed by the schema, flagged by an adapter warning. |
| OQ5 | Who owns the storefront link resolver, and what URL/variant-parameter format does the ONOE storefront use? |
| OQ6 | Does any developer, staging, or production database already contain `Product` rows? Unknown: none was inspected. A human must answer before any migration is authored, although the conservative backfill (D10) is required either way. |
| OQ7 | Should GTINs be normalized to a canonical length (for example zero-padded to 14 digits) so padding-equivalent values collide on the unique index? |

Live-account questions (Merchant Center roles, data-source creation,
consent-screen status, quotas) are unchanged and remain in
`docs/plans/google-merchant-adapter.md` §13.C. They do not affect this ADR.

## Approval

Status stays **Proposed** until a human accepts it. If it is accepted, the
next step is a separate approval to apply the Prisma and Zod changes and
tests (Slice 0 step 2). Authoring the migration is a further approval, and
column removal a further one after that.
