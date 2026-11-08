# AI Ads Management module — implementation plan

Status: draft, nothing implemented yet. See ADR 0007 for the scope and
third-party decision this plan executes.

## Scope

1. `src/lib/ads/meta/client.ts` — server-only Meta Marketing API read
   client, one method set: list campaigns/ad sets/ads for the bound
   account, get insights for a campaign/ad set/ad over a date range, get
   current budget/bid/status for a campaign/ad set. Fixed origin
   (`https://graph.facebook.com`), one pinned Graph API version, GET-only.
   Bind to one `adAccountId` at construction; reject any other account
   before token acquisition (same `checkedParent`-style guard as
   `merchant-readonly/client.ts`). Bounded JSON parsing at the same cap
   (8 MiB) and same byte-counted-before-parse approach. No token or
   response body in thrown errors.
2. `src/lib/ads/shopify/client.ts` — server-only Shopify read adapter over
   `@shopify/shopify-api`, scoped to `read_orders` and `read_products`.
   Exposes exactly: list orders in a date range (with UTM/referrer/landing
   page fields), get line items for an order. Bind to one shop domain;
   reject any other shop before token use. No write call is exposed by this
   module (the underlying package's write methods are not re-exported).
3. `src/lib/ads/matching/` — deterministic join: a Shopify order matches a
   Meta ad when the order's UTM parameters (or, failing that, landing-page
   path) match values the data-collection agent recorded for that ad's
   delivery window. No fuzzy/ML matching in this phase. Unmatched orders
   are returned as a distinct, explicit category, never silently dropped or
   guessed into a match.
4. `src/lib/ads/analytics/` — pure functions computing CTR, CPC, CPA and
   ROAS from matched-order + insight data already in hand. No database
   write. No caching layer in the first slice; add one only if a real
   latency problem is measured.
5. `src/lib/ads/recommendations/` — the only module calling
   `prisma.proposal.create`. Extend the Prisma `ProposalType` enum with
   `meta_budget_change`, `meta_bid_change`, `meta_campaign_status_change`
   (migration: add-only, no backfill needed — existing rows keep their
   current type values). Each created proposal carries `before`/`after`
   snapshots of the specific field (e.g. budget amount) and a non-empty
   `rationale` citing the metric(s) that triggered it. A configured ceiling
   (e.g. budget change requested must be <= 20% of current budget, exact
   number to be set with the owner before this ships) blocks larger
   requests from being silently created; those are created anyway but with
   `requires manual review` prefixed in `rationale`, never clamped to the
   ceiling value (clamping would silently change the proposal's meaning).
6. Dashboard: extend the existing Proposal inbox (not yet built as UI; this
   is tracked by `docs/plans/v0.1.md`'s milestone sequence) to render the
   three new ads proposal types with their before/after and rationale. No
   new approval mechanism — same approve/reject buttons calling the
   existing `approveProposal`/`rejectProposal`.

## Explicitly out of scope for this plan

- Any Meta or Shopify write call. Any execution of an `approved` proposal
  against a live platform. Both require a separate ADR per ADR 0007's
  non-goals.
- Multi-tenant credential storage. This phase targets one configured Meta
  ad account and one configured Shopify shop, read from runtime
  configuration (not committed), matching ADR 0005's single-account scope.
- Any probabilistic or ML-based attribution model.

## Security and test requirements

- Offline tests only; no live Meta or Shopify account is used in CI, same
  as every existing adapter.
- `src/lib/ads/meta/client.ts` and `shopify/client.ts` each get: a fake
  fetcher/SDK-double test proving (a) the fixed origin and pinned version
  are used regardless of input, (b) a request for a non-bound account/shop
  is rejected before any token or SDK call, (c) a malformed/oversized
  response is rejected without throwing the raw body, (d) no token value
  ever appears in a thrown error message.
- An architecture test (mirroring
  `src/lib/merchant/google/architecture.test.ts` and
  `src/lib/merchant/pinterest/architecture.test.ts`) asserts that
  `src/lib/ads/meta/` and `src/lib/ads/shopify/` export no function whose
  name or behavior performs a POST/PUT/DELETE/PATCH — a regression guard
  against a write method being added without a new ADR.
- `src/lib/ads/recommendations/` tests: a proposal is never created with
  `status` other than `pending`; a proposal requesting a budget change over
  the configured ceiling always contains the manual-review marker; a
  proposal's `rationale` is never empty (reuse the existing non-empty
  validation convention from `proposals.ts` if one is factored out, or add
  an equivalent check here).
- Run the existing full suite (`npm test`, lint, typecheck, build, `npm
  audit`) after each slice, same release gate as every prior ADR's plan.

## Sequencing

| Step | Deliverable | Depends on |
|---|---|---|
| 1 | ADR 0007 merged | — |
| 2 | `meta/client.ts` + tests | 1, a configured Meta System User token with `ads_read` for local/CI testing (fake fetcher only — no token needed to pass tests, but needed for the owner's own manual check, same as ADR 0005's pattern) |
| 3 | `shopify/client.ts` + tests | 1, `@shopify/shopify-api` added to `package.json` (new dependency — call out explicitly in that PR's diff, run `npm audit` before merge) |
| 4 | `matching/` + tests | 2, 3 |
| 5 | `analytics/` + tests | 4 |
| 6 | `recommendations/` + Prisma enum migration + tests | 5 |
| 7 | Dashboard inbox rendering for the three new proposal types | 6, and whatever milestone first ships the inbox UI itself |
| 8 | Owner-performed manual read-only check against one real ad account (reporting only — no file changes expected), independent security review | 2–6 complete |

Step 8 mirrors ADR 0005's "owner-reported operational check" gate: this plan
does not consider the module production-ready from code review alone.

## Sources

See ADR 0007.
