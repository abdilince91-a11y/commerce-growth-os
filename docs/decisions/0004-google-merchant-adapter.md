# ADR 0004: Fixture-only Google Merchant adapter boundary

Status: **Accepted** (2026-09-22)
Date: 2026-09-22
Related: ADR 0002 (human approval gate), ADR 0003 (canonical Product/Variant),
`docs/plans/google-merchant-adapter.md`

## Context

The v0.1 milestone needs a deterministic Google Merchant representation of
canonical `Product` and `Variant` records before any live Google account is
connected. Mixing mapping, authentication, transport, and publication in one
step would make it possible for validation code to acquire write capability
before the approval gate and credential design have been reviewed.

Google Merchant's `content` OAuth scope is not read-only. A future connection
therefore cannot rely on the scope alone to prevent writes; read-only behavior
must be enforced structurally by the client API. That live connection has
different security, storage, role, and operational questions and is not part
of this decision.

## Decision

### 1. The v0.1 adapter is fixture-only and transport-free

The adapter maps canonical records into the Google Merchant API
`products/v1` `ProductInput` shape using pure, deterministic functions. It has
no HTTP client, Google SDK, OAuth flow, credentials, environment-variable
access, database access, retry behavior, clock, randomness, or account/data
source identifier.

The public adapter exposes exactly three operations:

- `mapOffer` — map one canonical offer;
- `mapOffers` — map and cross-validate a batch;
- `toFeedUpdateProposal` — wrap a mapped preview in a validated
  `ProposalCreateInput`.

No insert, update, delete, publish, apply, or synchronization operation exists.

### 2. Identity and payload rules follow ADR 0003

- `offerId` is `Variant.sku`.
- `itemGroupId` is the canonical `Product.id` verbatim.
- `productInputId` is
  `contentLanguage~feedLabel~offerId` and is deterministic.
- Channel configuration alone supplies `contentLanguage` and `feedLabel`.
- A finished storefront URL is supplied as adapter context; the adapter does
  not derive a Shopify-specific URL.
- Money uses exact `BigInt` arithmetic and emits `amountMicros` as a JSON
  string. The v0.1 adapter accepts only EUR and TRY.
- Draft and archived records are skipped; malformed active records return
  structured issues. Nothing causes an automatic deletion.

The implemented payload subset follows the Merchant API v1 discovery schema
reviewed for Slice 2 (revision 20260910) and the Google product data
specification. The evidence URLs are recorded in the implementation plan.

### 3. Proposal creation remains a preview boundary

Only a runtime-validated `mapped` result can become a proposal preview. The
result is validated with `ProposalCreateInputSchema` and has:

- `type: "feed_update"`;
- `targetEntity: "google_merchant_product_input"`;
- the deterministic `productInputId` as `targetId`;
- the prior Merchant payload, or `{ "state": "absent" }`, as `before`;
- the complete mapped payload as `after`;
- a deterministic rationale containing mapped field names and warning
  code/path pairs, never product descriptions or URLs;
- `createdBy: "system"`.

It never includes `status`, `decidedBy`, or `decidedAt`. The adapter neither
creates a database row nor imports or calls `applyProposal`. Human approval
and proposal persistence remain separate concerns governed by ADR 0002.

### 4. The boundary is mechanically enforced

For `src/lib/merchant/**`, ESLint rejects `fetch`, network libraries,
Google SDK imports, database access, and the proposal execution service. An
architecture test scans every shipped Merchant module for transport,
database, environment-secret, proposal-persistence, and proposal-application
capabilities.

These controls supplement normal tests: a future edit that introduces such a
capability fails CI before it can be merged into protected `main`.

### 5. Live phases require new decisions

An authenticated read-only Merchant connection is a future phase and requires
its own ADR and security review. Its client type must expose list/get methods
only; insert/update/delete methods must be impossible to express. Merchant
Center roles, developer registration, OAuth consent status, token storage,
account/data-source identifiers, quotas, and real channel configuration must
be resolved before that phase begins.

A later write transport requires another explicit decision. It may consume
only a database proposal already approved by a human, must revalidate the
payload immediately before sending, and must never implement automatic
deletion.

## Verification evidence

The accepted implementation was verified offline on 2026-09-22:

- `npm run typecheck` passed;
- `npm run lint` passed before and after the production build;
- `npm test` passed, 719/719 tests;
- `npm run build` passed with Next.js 16.3.5;
- `npm audit` reported 0 vulnerabilities;
- `git diff --check` passed;
- CI `verify` passed on PR #9 before merge;
- no dependency, lockfile, Prisma schema, migration, `.env`, credential,
  network, database, or live-account change was included.

## Consequences

- Canonical data can be validated and previewed for Google Merchant without
  creating any external side effect.
- The approval gate receives a deterministic, auditable proposal input, but
  no persistence or application capability is granted to the adapter.
- A real Merchant Center account cannot be connected accidentally by extending
  this module; that work must cross a new architectural and security gate.
- The milestone does not prove acceptance by a live Merchant account. Country,
  language, role, quota, and account-specific behavior remain deliberately
  untested until the read-only phase.
