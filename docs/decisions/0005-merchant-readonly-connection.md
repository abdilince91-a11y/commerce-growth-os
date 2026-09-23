# ADR 0005: Merchant API read-only transport boundary

Status: **Proposed** (2026-09-23; manual account-access check passed, independent security and deployment review pending)

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

Offline tests must show fixed-origin GET-only requests, rejection of a foreign account before token acquisition, rejected malformed inputs and responses, no token leakage in errors, and no write methods. The owner reported successful developer registration with their Merchant administrator OAuth identity and a successful manual `products.list` GET with a short-lived, `content`-scoped token minted for the Merchant `READ_ONLY` service account. The manual request returned one product on a page of size one. These are owner-reported operational checks outside this repository; the draft client still has no credential provider or production caller. Deployment identity, quota behavior and an independent security review remain gates for application integration. The registration used an empty body; technical contact information was not added in that call.

Google's published guidance has a role discrepancy: the `accounts.users` REST reference explicitly says `READ_ONLY` can use read-only methods and cannot use mutating methods, whereas the quickstart FAQ says identities making API calls after project registration must have `ADMIN`. The owner-reported live `list` GET worked with the `READ_ONLY` service account; `get` has not been tested. Retain `READ_ONLY`; if a future read is rejected, review the access model instead of silently elevating the long-running reader. No product input was created, updated or deleted during the manual test.

## Sources

- https://developers.google.com/merchant/api/guides/quickstart/authentication
- https://developers.google.com/merchant/api/guides/quickstart/registration
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/get
- https://developers.google.com/merchant/api/reference/rest/accounts_v1/accounts.users
- https://developers.google.com/merchant/api/guides/quickstart/faq
- https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys
- https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken
