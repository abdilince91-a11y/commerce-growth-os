# Security hardening — 2026-10-23

Base: main at 7409e57b559146ce103e93456240ad6790f28708.

## Observed boundaries

- No PHP or Composer files are present in the tracked repository. This is a
  source inventory, not proof about deployed images or third-party services.
- The Merchant transport is fixed-origin GET-only, account-bound, has request
  timeouts, suppresses upstream errors, and uses a keyless token provider.
- The Cloud Run helper creates a one-shot job, with no retries, using an attached
  reader identity. Live IAM, Merchant roles, deployed digests and billing have not
  been inspected in this environment.
- Proposal decisions currently read and then update by ID alone. Concurrent
  decisions can overwrite each other. The module is internal and has no public
  HTTP handler; it does not implement user authentication.
- CI runs lint/type/tests and a smoke image check, but has no explicit token
  permissions, dependency audit, daily image scan or update proposals.
- GitHub ruleset 23845300 is active on main: PR required, verify required,
  deletion/force push blocked, no bypass. No approving review is required.

## Implementation

1. Bound streamed Merchant JSON to 8 MiB before parsing, even if Content-Length
   is absent or false. Cancel rejected bodies and keep errors static. Test
   chunked overflow, header overflow, multibyte bytes and malformed bodies.
2. Require an explicit runtime read opt-in at every keyless token acquisition;
   keep the deployment helper opt-in explicit and test the disabled path.
   Make proposal transitions conditional on the state that was read. Refuse
   blank/control-character decision identities and missing approval timestamps.
   Test concurrent decisions and duplicate applications with a stateful fake DB.
3. Give CI read-only token permissions, remove persisted checkout credentials,
   pin official actions by verified commit SHA, and include dependency audit and
   production build in the existing required verify job.
4. Add daily/manual npm and container vulnerability scans, and weekly Dependabot
   update proposals for npm, Docker and GitHub Actions. These never auto-merge or
   deploy. Keep the existing non-root, dependency-free smoke container.
5. Document incident pause, update/redeploy, least-privilege and backup/restore
   verification procedures, distinguishing verified repository controls from
   unverified production settings.

## Validation and release

Run focused regression tests, full suite, Prisma generation with a process-local
non-routable dummy database URL, typecheck, lint, build, dependency audit, and
whitespace checks. Docker/Windows checks run in GitHub CI when unavailable locally.
Review the complete diff for credentials and unintended writes. Publish a branch
and a reviewable PR; do not merge or deploy as part of this change. No live Merchant
request, Cloud resource creation, IAM permission change or paid deployment is needed.

## Findings discovered during validation

The fresh npm advisory response reported six affected packages (one critical,
three high, two moderate), including Next.js 16.3.6. Updated compatible dependencies
and raised direct dependency minimums to Next.js/eslint-config-next 16.4.3,
Vite 8.3.5 and Vitest 5.0.5; sharp 0.35.5 and source-map-js 1.2.2 are locked.
The first CI image scan reported HIGH/CRITICAL findings in the Debian 12 base
and bundled, unused npm tools. The final smoke base uses the verified official
Distroless Node 22 Debian 13 nonroot digest, removing the shell and package
managers. CI also checks those runtime properties before scanning. Scanner
findings describe package exposure, not proof of successful exploitation.

Vendor advisories checked:
- https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr
- https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw

## Validation results

- 761 tests in 21 files pass (26 additional regression cases).
- Prisma client generation, TypeScript, ESLint, production build and
  `git diff --check` pass. Prisma generation used a process-local dummy database
  URL; no database connection or schema migration was performed.
- npm audit reports zero known vulnerabilities after dependency updates.
- All workflow/Dependabot YAML parses. Known credential-pattern search found no
  matches in tracked source files; this is not a comprehensive secrets audit.
- No Docker engine or PowerShell runtime is installed in this workspace. GitHub
  CI validates the image build/Trivy scan and Windows script parse; both passed
  through the smoke execution stage on the first run, before the base-image
  vulnerability findings described above. The final image must pass a fresh run.
- Proposal persistence regression cases use a stateful fake database. The Prisma
  conditional update filters typecheck, but no live PostgreSQL integration test
  or independent human review has been completed.
- No production deployment, live Merchant request, role change or paid Cloud
  resource was performed. Production IAM, backups and monitoring remain pending.
