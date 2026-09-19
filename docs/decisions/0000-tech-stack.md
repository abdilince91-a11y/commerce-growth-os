# ADR 0000: Tech stack for v0.1

Status: Accepted
Date: 2026-08-29

## Context

The repository had no dependencies and no framework chosen. `.gitignore`
already anticipated `.next/` and `dist/` build output, and
`.env.example` had a single `DATABASE_URL`, suggesting a Next.js +
relational-DB direction, but nothing was committed to. See
`docs/plans/v0.1.md` §3 for the proposal and rationale; this ADR
records the accepted decision.

## Decision

- **Language**: TypeScript, strict mode, across app and API code.
- **App framework**: Next.js (App Router) — dashboard shell and API
  routes in one deployable.
- **Database**: PostgreSQL.
- **ORM / migrations**: Prisma — schema-as-code, generated types
  consumed directly by the rest of the app.
- **Schema validation**: Zod — validates untrusted external input
  (Merchant/Pinterest feed data, AI-generated output) at system
  boundaries, per CLAUDE.md's untrusted-input rule.
- **Tests**: Vitest.
- **Lint/typecheck**: ESLint + TypeScript compiler in strict mode.
- **CI**: GitHub Actions running lint, typecheck, and test on every PR.

## Consequences

- All future modules (schema, adapters, scoring, recommendations,
  dashboard) are built on this stack; introducing a second language or
  framework requires a new ADR superseding this one.
- Prisma's generated types become the shared vocabulary between the DB
  layer and the rest of the app — canonical schema changes flow through
  a Prisma migration, not ad hoc SQL.
- Every external-data entry point must have a Zod schema before it's
  wired up; this is enforced by convention/review, not tooling, for now.
