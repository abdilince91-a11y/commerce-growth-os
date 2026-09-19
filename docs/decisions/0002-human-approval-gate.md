# ADR 0002: Human approval gate (`Proposal` model)

Status: Accepted
Date: 2026-08-29

## Context

CLAUDE.md's safety boundaries require that budget, ROAS, attribution,
bidding, feed, and metadata changes are "prepared as proposals first,"
and that destructive or high-impact actions require explicit human
approval. Multiple future modules (metadata scoring, recommendations,
eventually bidding) all need this same gating behavior. Building it
once, as a shared primitive, means the safety property is enforced by
the data model itself rather than by each module remembering to check.
Draft shape proposed in `docs/plans/v0.1.md` §5.

## Decision

A single `Proposal` model is the only way any automated module changes
state that matters (product metadata, feed contents, budgets, bids,
etc.). No module writes directly to a "live" record.

| Field | Type | Notes |
|---|---|---|
| `id` | string (cuid) | |
| `type` | enum | `metadata_change`, `feed_update`, `budget_change`, `bid_change` (extend as new modules are added) |
| `targetEntity` | string | e.g. `"product"`, `"campaign"` |
| `targetId` | string | id of the affected record |
| `before` | JSON | full snapshot of prior state |
| `after` | JSON | full snapshot of proposed state |
| `rationale` | string | required, non-empty — every recommendation must be explainable |
| `status` | enum | `pending`, `approved`, `rejected`, `applied` |
| `createdBy` | enum | `system`, `user` |
| `decidedBy` | string? | human identity; required before status can leave `pending` |
| `decidedAt` | datetime? | |

State machine:
```
pending --(human approves)--> approved --(system applies)--> applied
pending --(human rejects)--> rejected
```

Enforcement rule: the transition to `approved` or `rejected` requires
`decidedBy` to be set in the same operation; the transition to
`applied` requires the record to already be `approved`. There is no
code path that sets `status = applied` without having passed through
`approved` first. This is enforced in the service layer
(`src/lib/proposals.ts`) and covered by a unit test that asserts the
direct `pending -> applied` transition is rejected.

## Consequences

- Every future module that "does something" (scoring, recommendations,
  feed sync) actually just creates `Proposal` rows. It has no
  permission to mutate target entities directly. This is a stronger
  constraint than a code-review convention — it's structural.
- The dashboard shell's first real feature is a `Proposal` inbox
  (list/approve/reject), which is why it's last in the milestone
  sequence: it has nothing to show until this model and at least one
  producer exist.
- `before`/`after` as JSON snapshots (rather than diffs) trade storage
  efficiency for simplicity and auditability — acceptable for v0.1
  volumes.
