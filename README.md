# Commerce Growth OS

AI-assisted commerce growth platform for product discovery, feed quality, search intelligence, advertising analytics, and controlled optimization across Google and Pinterest.

## v0.1 scope
- Canonical product schema
- Product metadata quality scoring
- Search-intent clustering
- Google Merchant feed generation layer
- Pinterest feed generation layer
- Optimization recommendation model
- Human approval gates
- Initial dashboard shell
- Tests, security rules, and CI foundations

## Explicitly out of scope for v0.1
- Automatic campaign publishing
- Automatic budget increases
- Automatic destructive actions
- Fully autonomous bidding changes

## Architecture

```text
Canonical Product Data
        |
        +--> Search Intelligence
        |
        +--> Metadata Optimizer
        |        |
        |        +--> Google Merchant adapter
        |        +--> Pinterest adapter
        |
        +--> Analytics Engine
                 |
                 +--> Recommendations
                          |
                          +--> Human Approval
```

## Engineering team
Claude Code is organized around six specialist roles stored under `.claude/agents/`.

## Tech stack
TypeScript, Next.js (App Router), PostgreSQL, Prisma, Zod, Vitest, GitHub
Actions. See `docs/decisions/0000-tech-stack.md` for rationale.

## Local setup
1. Copy `.env.example` to `.env.local` and point `DATABASE_URL` at a
   local PostgreSQL instance.
2. Add only local development credentials.
3. Never commit `.env.local`.
4. `npm install`
5. `npm run prisma:generate` (generates the Prisma client; does not
   require a live database)
6. `npm run prisma:migrate` (applies the schema to your local database)
7. `npm run dev` to start the app.
8. Run `npm test`, `npm run lint`, and `npm run typecheck` before
   opening a pull request.

## Project structure
```text
prisma/schema.prisma   canonical Product + Proposal models
src/app/                Next.js App Router (dashboard shell)
src/lib/schema/         Zod validators for untrusted external input
src/lib/db.ts           Prisma client singleton
src/lib/proposals.ts    human-approval state machine (see ADR 0002)
docs/decisions/          ADRs
docs/plans/              implementation plans
```

## First milestone
See `docs/plans/v0.1.md`.
