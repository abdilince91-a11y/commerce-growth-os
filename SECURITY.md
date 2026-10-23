# Security boundary and incident response

## What is protected in this repository

- Merchant product reads use a fixed Google origin, GET-only operations and one
  bound Merchant account. Redirects are rejected. Tokens and upstream bodies are
  omitted from errors. Requests time out; JSON responses are capped at 8 MiB
  before parsing, with byte counting independent of Content-Length. Large valid
  pages can exceed this cap; request a smaller pageSize rather than silently
  removing the limit.
- The keyless provider refuses token acquisition unless
  `GOOGLE_MERCHANT_READ_ENABLED` is exactly `true`, checked on every call. The
  manual one-shot deployment helper explicitly opts that job in. Setting it to
  `false` prevents subsequent acquisitions in the updated workload; it does not
  revoke already-issued tokens or cancel an in-flight request/execution.
- Authentication uses the attached Cloud Run service identity and short-lived
  tokens. Local ADC fallback and downloaded private keys are not used by the
  application. The Merchant `content` OAuth scope is **not** read-only: the
  Merchant account's `READ_ONLY` role must enforce that restriction in production.
- Proposal state changes use conditional database updates: a concurrent decision
  cannot overwrite an earlier decision, and one approval cannot be marked applied
  twice. Approval requires a nonblank decision identity and timestamp. This is
  **not user authentication**: future HTTP handlers must authenticate/authorize the
  operator server-side before calling this internal module. A supplied string is
  not evidence of a human. No external proposal execution exists yet; an outbox
  and platform idempotency design are needed before implementing one.
- The Merchant smoke image uses the official Distroless Node 22 Debian 13
  nonroot runtime (UID/GID 65532). It has no shell or package manager, copies only
  the explicit probe files, installs no npm dependencies and pins its base by
  digest. CI verifies the built image is non-root and has no shell or npm.
- Required CI `verify` audits npm, generates Prisma, checks lint/types/tests,
  builds Next.js, verifies the smoke image fails closed outside Cloud Run, and
  scans its OS/runtime packages with Trivy. HIGH/CRITICAL findings fail the job,
  including findings without a vendor fix. GitHub Actions have read-only tokens,
  non-persisted checkout credentials and pinned action commits.
- `Security` repeats npm and image scans daily and after main changes, and can
  be run manually. Scheduled checks start only after the workflow is merged to
  the default branch. Failures appear in GitHub Actions; notification delivery
  depends on the repository owner's GitHub notification settings.
- Dependabot proposes weekly npm, Docker and Actions updates. Nothing auto-merges
  or deploys. Update the lockfile and pinned image digest through reviewed PRs;
  digest pinning alone does not install future security patches.

These are layered controls, not a claim that the service cannot be compromised.
The repository contains no PHP source/runtime definition. External apps, hosting
and deployed images must be inventoried separately; `npm audit` does not scan PHP
or operating-system packages. A clean scan only covers vulnerabilities known to
that scanner at the time.

## Verified GitHub settings (2026-10-23)

Ruleset `Protect main` (23845300) is active: PRs and `verify` are required; branch
force pushes and deletion are blocked; no bypass actor is configured. It does
not require an approving human review, and does not require the branch to be
up-to-date. These settings were read, not changed. The Windows syntax job is not
currently a required status check.

## Production checks still required

No Google Cloud connection, deployed job inventory or live database was available
for this review. The following are **not verified or configured by this PR**:

1. Inventory Cloud Run jobs/services and exact deployed image digests. Scan the
   deployed digest as well as the image built from source; old deployments do
   not inherit a patch merely because GitHub changed.
2. Confirm the reader's Merchant role is `READ_ONLY`. Check project IAM and
   service-account impersonation bindings; remove unnecessary grants only after
   identifying their current use. Do not elevate the reader to administrator to
   fix a failed read. No negative write test should touch a live product.
3. Confirm no unauthenticated Cloud Run service invocation and no unnecessary
   external ingress. The current helper creates a job, not a public HTTP service.
   Do not confuse that source configuration with proof of live IAM settings.
4. Configure resource limits, quotas, billing alerts and owner notifications.
   A billing alert is not a hard spending cap. Do not create a public deployment
   or new paid resources merely to complete this review.
5. Identify whether a live PostgreSQL database exists. If it does, confirm least
   privilege, private connectivity, encrypted backups, retention, and perform a
   restore to an isolated environment. There are no migrations in this repository;
   do not apply a destructive schema sync to an unknown database.
6. Keep Shopify/Meta/Pinterest app permissions and tokens separate from the
   Merchant reader. Do not place private keys, refresh tokens, customer data,
   raw product responses or environment files in GitHub issues or CI logs.

## If a new vulnerability or suspected compromise is reported

1. Identify the affected runtime/version and deployed workload. Check the vendor
   advisory against the lockfile, container packages and actual deployed digest.
2. Pause new executions of the affected job, including external schedulers, and
   disable `GOOGLE_MERCHANT_READ_ENABLED` in the workload configuration. For
   an active incident, an authorized operator can cancel running executions and
   temporarily revoke the affected identity's Merchant access. This intentionally
   interrupts reads; no automatic product deletion or bulk rollback is allowed.
3. Preserve restricted-access audit logs before cleanup. Look for unexpected
   identity grants, executions and outbound requests. Do not copy secrets into
   incident reports. If exposure is suspected, revoke/rotate affected credentials
   and sessions after preserving evidence; patching alone does not remove an
   attacker's existing access.
4. Patch the affected runtime/dependencies, rebuild and scan a new image, run all
   tests, then deploy the verified digest. Never roll back to a known vulnerable
   image; a safe rollback must also contain the security patch.
5. Resume with one read-only check after explicit operational approval. Verify
   identity, logs and costs. Record what was observed, what changed and remaining
   uncertainty. Product writes and ad spending retain their separate approval gates.

## Reporting

Do not publish exploit details, credentials or customer information in a public
issue. Use GitHub private vulnerability reporting if the repository owner has
it enabled; otherwise arrange a private contact with the owner first.
