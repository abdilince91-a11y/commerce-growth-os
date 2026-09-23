# ADR 0005: Merchant API read-only transport boundary

Status: **Proposed** (2026-09-23; security and account-access review pending)

## Context

ADR 0004 keeps the canonical Google Merchant adapter offline. The next phase needs to inspect processed products without acquiring the ability to change them. Google's product `list` and `get` methods require the `https://www.googleapis.com/auth/content` scope, which by itself does not guarantee read-only behavior. The current plan's statement that a human OAuth consent flow is universally required is too broad: Google recommends a service account for one's own business and an OAuth consent flow for third-party applications serving other businesses.

## Decision

- Add a separate server-only client with `listProducts` and `getProduct` as its sole operations. The origin, API version and GET routes are fixed; callers cannot supply URLs, methods, headers, or bodies. Do not add product input methods, registration, persistence or proposal application.
- Inject a short-lived bearer token supplier. Obtaining, refreshing, storing and revoking credentials remain outside this boundary. No tokens or response bodies appear in thrown errors or logs.
- Treat Merchant responses as untrusted. Return a validated minimal projection of processed products, scoped to the requested account; no automatic pagination or background sync.
- Retain the offline adapter's no-network rules. A distinct module implements the transport so the existing preview boundary stays intact.
- Bind each client instance to one configured Merchant account ID. Reject requests for another account before obtaining a token or issuing HTTP requests. The account ID is supplied at runtime, not committed to this repository.
- Start with own-account service account authentication at deployment, subject to verifying the Merchant account's role and Google Cloud registration. Prefer keyless workload identity where the hosting environment supports it; no downloaded JSON private key or token belongs in the repository. If this becomes a multi-merchant product, design OAuth consent and token storage separately.
- Separate the one-time developer registration from the long-running reader identity. Google requires an `ADMIN` identity to perform `registerGcp`, but documents `READ_ONLY` as having no mutating API methods. Use the owner's existing Merchant administrator identity for one-time registration if a project-bound OAuth flow can be arranged, then grant the service account only `READ_ONLY` and verify actual list/get access. Do not assign the service account `ADMIN` merely to simplify registration.

## Security and release gates

Offline tests must show fixed-origin GET-only requests, rejection of a foreign account before token acquisition, rejected malformed inputs and responses, no token leakage in errors, and no write methods. An independent security review and live account setup are required before connecting a real account. The owner reported a dedicated project with Merchant API enabled and a service-account identity; neither developer registration nor Merchant account access, credentials, deployment identity, quotas, or a live read has been verified by this application. The current draft has no credential provider or production caller and does not claim a live connection exists.

Google's published guidance has a role discrepancy: the `accounts.users` REST reference explicitly says `READ_ONLY` can use read-only methods and cannot use mutating methods, whereas the quickstart FAQ says identities making API calls after project registration must have `ADMIN`. Keep the reader unprivileged until this is resolved by a harmless live list/get test with `READ_ONLY`. If Google rejects that role, do not silently elevate the long-running reader to `ADMIN`; revisit the design and obtain a separate review. A live test must not create, update, or delete Merchant data.

## Sources

- https://developers.google.com/merchant/api/guides/quickstart/authentication
- https://developers.google.com/merchant/api/guides/quickstart/registration
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/get
- https://developers.google.com/merchant/api/reference/rest/accounts_v1/accounts.users
- https://developers.google.com/merchant/api/guides/quickstart/faq
- https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys
