# ADR 0007: Meta Ads / Shopify AI Ads Management — read-only foundation

Status: **Proposed** (draft, 2026-11-08). No code exists yet. This ADR gates
scope and third-party choices before any implementation begins.

## Context

The product needs a multi-agent AI Ads Management module covering Meta
Marketing API (campaign/ad/insight reads, eventually budget/bid/status
writes) and Shopify order data (for revenue attribution: CTR, CPC, CPA,
ROAS). CLAUDE.md's safety boundaries require that budget, ROAS, attribution
and bidding changes are prepared as proposals first, that campaigns are
never published automatically and that budgets are never increased
automatically. ADR 0002 already built the only sanctioned mechanism for any
module to change state that matters (`Proposal`, with its `pending ->
approved -> applied` state machine enforced in `src/lib/proposals.ts`). ADR
0005 already built the only sanctioned shape for a read-only external
transport (fixed origin, GET-only, account-bound, keyless short-lived token,
bounded response parsing, no token/body leakage). This ADR applies both
existing patterns to a second and third external platform instead of
inventing new ones.

### Third-party options considered

| | `getmcpads-com/meta-ads-mcp-server` | `meta/facebook-python-business-sdk` |
|---|---|---|
| License | Apache-2.0 | Custom "Facebook Platform License" — conditioned on Facebook Platform Policy, not an OSI license |
| Language | TypeScript, Node >=22.12 | Python |
| Maturity | ~11 commits, first tagged release 2026-09-20, maintained by a small team alongside a commercial hosted product (getmcpads.com) that the README repeatedly upsells | Official Meta SDK; last commit 2026-11-05 (days old); long-lived, vendor-backed |
| Integration shape | MCP protocol over stdio — a separate process an MCP *client* (Claude Desktop/Code, Cursor) talks to; not an importable library for a Next.js API route | Python package (`facebook_business`); importable only from a Python runtime |
| Write surface | 23 write tools, off by default, "preview before it applies" | Full Marketing API, including campaign/ad create/update/delete — far broader than this module needs |
| Security design (as documented) | Fixed host (`graph.facebook.com` only), redirects refused once a token is attached, token kept in memory only, no telemetry | N/A — general-purpose client, no built-in restriction to a read-only subset |

Neither is adopted as a runtime dependency:

- `meta-ads-mcp-server` speaks the wrong protocol for this codebase (MCP, not
  an importable module) and is young enough, and commercially entangled
  enough with its own hosted product, that depending on it for a
  write-capable advertising feature is a maintenance and continuity risk
  this project does not need to take. Its source is read as a **design
  reference** (metric/breakdown compatibility matrix, query splitting,
  "preview before it applies" UX) — ideas, not code, are reused. A human
  operator may separately run it inside their own Claude Desktop/Code MCP
  client for ad hoc read-only exploration; that is outside this repository
  and outside this ADR.
- `facebook-python-business-sdk` is Python. Adopting it would add a second
  language/runtime, which ADR 0000 says requires "a new ADR superseding
  this one" — this ADR does not attempt that and does not propose it. It
  also wraps the full Marketing API, including every write operation this
  project explicitly defers (see Non-goals); importing it would mean
  relying on application code to withhold privileges the transport layer
  itself does not withhold, which is a weaker default than ADR 0005's
  design.

## Decision

- Build a custom, narrow, server-only Meta Marketing API read client at
  `src/lib/ads/meta/client.ts`, in the exact shape of
  `src/lib/merchant-readonly/client.ts`: fixed origin
  (`https://graph.facebook.com`), one pinned Graph API version, GET-only,
  bound to one `adAccountId` at construction (requests for another account
  are rejected before token acquisition), bounded response parsing, no
  token or response body in thrown errors, injected token supplier (System
  User token with `ads_read` only — `ads_management` is out of scope; see
  Non-goals).
- Build a Shopify read adapter at `src/lib/ads/shopify/client.ts`. Shopify's
  official `@shopify/shopify-api` package is TypeScript-native and does not
  raise ADR 0000's second-language concern, so it may be used as the
  underlying HTTP/GraphQL client — but only from behind this adapter, which
  exposes exactly the order/line-item read operations this module needs
  (scoped to `read_orders`, `read_products`) and nothing else. No route
  handler or agent calls `@shopify/shopify-api` directly.
- Add `src/lib/ads/matching/` (deterministic Shopify-order-to-Meta-ad
  matching via UTM/referrer/landing-page data already on the order; no
  probabilistic/ML attribution in this phase) and `src/lib/ads/analytics/`
  (CTR/CPC/CPA/ROAS computed on read, not persisted — mirrors ADR 0005's "no
  automatic pagination or background sync").
- Add `src/lib/ads/recommendations/`, the only module in this slice allowed
  to call `prisma.proposal.create`. It extends `ProposalType` with
  platform-prefixed values (`meta_budget_change`, `meta_bid_change`,
  `meta_campaign_status_change`) rather than reusing the generic
  `budget_change`/`bid_change` values, so ads proposals are distinguishable
  from a future non-ads budget proposal. `rationale` stays required per ADR
  0002. A hard-coded ceiling (percentage of current budget) blocks any
  single proposal from requesting a larger jump; a proposal that would
  exceed it is created with an explicit `requires manual review` marker in
  `rationale` rather than silently clamped or dropped.
- The multi-agent decomposition is: a data-collection agent (calls the two
  read clients only), a matching agent (Shopify <-> Meta join, read-only),
  an analytics agent (metric computation, read-only), and a recommendation
  agent (the only one permitted to write `Proposal` rows, and only rows —
  never `approved`/`applied` status, which `src/lib/proposals.ts` already
  restricts to a human decision plus `applyProposal`). No agent in this
  phase has network access to any Meta or Shopify write endpoint, because
  no write endpoint exists in the transport layer yet.

## Non-goals (this ADR)

- No Meta write transport (campaign/ad/budget/bid create or update). No
  Shopify write transport.
- No automatic campaign publishing, no automatic budget increase, no
  automatic bidding change — CLAUDE.md prohibits all three regardless of
  this ADR.
- No execution of an `approved` ads `Proposal` against a live platform. The
  existing `applyProposal` only flips a database status; nothing in this
  slice calls it from a scheduled job or agent. A future write/execution
  capability needs its own ADR, its own independent security review, and
  (mirroring ADR 0005's rollout) an owner-performed manual live check before
  any production caller exists.
- No persisted raw Meta/Shopify API responses; no multi-tenant token
  storage design (single configured account/shop for this phase, like ADR
  0005's single Merchant account).

## Consequences

- Every future ads feature that "does something" to a live campaign still
  only creates `Proposal` rows, same as metadata/feed modules — no new gate
  mechanism, no exception carved out for ads.
- The query-planner/compatibility-matrix idea from `meta-ads-mcp-server` is
  worth reproducing as plain TypeScript inside `src/lib/ads/meta/` once real
  metric/breakdown combinations are enumerated; that is implementation
  detail for the plan document, not a dependency decision.
- Introducing Shopify's official client is allowed without a stack
  exception because it is already TypeScript; this does not set a
  precedent for Python or other-runtime dependencies elsewhere.

## Sources

- https://developers.facebook.com/docs/marketing-api/system-users
- https://developers.facebook.com/docs/graph-api
- https://shopify.dev/docs/api/shopify-app-remix (`@shopify/shopify-api` is its underlying client)
- https://github.com/getmcpads-com/meta-ads-mcp-server (README, SECURITY.md, package.json read 2026-11-08)
- https://github.com/meta/facebook-python-business-sdk (LICENSE, CHANGELOG read 2026-11-08)
