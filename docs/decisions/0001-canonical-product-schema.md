# ADR 0001: Canonical product schema

Status: Accepted
Date: 2026-08-29

## Context

Every module in the v0.1 architecture (search intelligence, metadata
scoring, Google Merchant adapter, Pinterest adapter, analytics,
recommendations) reads from one product representation. Per CLAUDE.md,
"canonical product data is the source of truth" and "platform-specific
metadata is derived from canonical data." The schema must be fixed
before any adapter is built, or adapters end up defining fields the
canonical model should own. Draft shape proposed in
`docs/plans/v0.1.md` §4.

## Decision

Canonical `Product` fields for v0.1:

| Field | Type | Notes |
|---|---|---|
| `id` | string (cuid) | internal canonical id, stable across platforms |
| `sku` | string | required, unique |
| `title` | string | required |
| `description` | string | required |
| `brand` | string? | optional |
| `gtin` | string? | at least one of `gtin`/`mpn` required — enforced by Zod refinement, not DB constraint |
| `mpn` | string? | see above |
| `category` | string | internal taxonomy; platform-specific category mapping happens in adapters, never here |
| `priceAmount` | decimal | stored as integer minor units in DB, decimal in the Zod/API layer |
| `priceCurrency` | string | ISO 4217 |
| `availability` | enum | `in_stock`, `out_of_stock`, `preorder`, `backorder` |
| `images` | string[] | URLs; first element is primary image |
| `attributes` | JSON (`Record<string,string>`) | free-form (color, size, material) |
| `sourceUpdatedAt` | datetime | last update time from whatever system feeds canonical data |
| `canonicalUpdatedAt` | datetime | last time this record changed in our system |

Rules:
- Platform adapters (Merchant, Pinterest) map **from** this shape only.
  If an adapter needs a field the canonical schema doesn't have, the
  schema is extended first — adapters never grow their own source of
  truth.
- All external product data is validated against the Zod schema at the
  boundary before touching the DB or any downstream module (untrusted
  input, per CLAUDE.md).
- Prisma schema is the DB-level source of truth for types; Zod schema
  in `src/lib/schema/product.ts` validates at the API/ingestion boundary
  and is kept in sync with Prisma by hand (no codegen bridge yet — a
  future ADR can introduce one if drift becomes a problem).

## Consequences

- Adding a field requires: Prisma migration + Zod schema update +
  version bump note in `CHANGELOG.md`. No shortcuts that add fields only
  to an adapter.
- `gtin`/`mpn`-required-one-of is a validation rule, not a DB
  constraint, since Postgres doesn't cleanly express "at least one of
  two nullable columns." Covered by a unit test instead.
- This schema will likely be incomplete for real Merchant/Pinterest
  feeds (e.g. GTIN format validation, multipack/bundle fields, shipping
  weight) — v0.1 intentionally ships the minimum needed for the
  adapters in scope, not full feed-spec parity.
