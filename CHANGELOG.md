# Changelog

## Unreleased
- Offline Pinterest retail catalog adapter: validated canonical variant rows,
  deterministic UTF-8 CSV previews, conflict checks and proposal snapshots.
- Security hardening: bounded Merchant response parsing, conditional proposal
  decisions/application, patched dependencies, pinned non-root probe image,
  required CI vulnerability checks, daily scans and weekly update proposals.
- Google Merchant adapter offline milestone: canonical Product/Variant mapping,
  deterministic `products/v1` payload previews, structured validation issues,
  exact money conversion, proposal-preview integration, and mechanical
  no-network/no-database/no-apply safeguards (ADR 0004)
- ADR 0000: tech stack (TypeScript, Next.js, PostgreSQL, Prisma, Zod, Vitest, GitHub Actions)
- ADR 0001: canonical product schema
- ADR 0002: human approval gate (`Proposal` state machine)
- Project scaffold: Next.js app shell, Prisma schema (`Product`, `Proposal`), Zod validators, Vitest suite (11 tests), ESLint config, GitHub Actions CI
- `docs/plans/v0.1.md` milestone sequence

## 0.1.0-foundation
- Initial repository architecture
- Six-agent Claude team
- Human approval safety gates
- CI and PR review foundations
- v0.1 implementation plan
