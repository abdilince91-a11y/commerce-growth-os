# ADR 0005: Merchant API read-only transport boundary

Status: **Proposed** (2026-09-23; security and account-access review pending)

## Context

ADR 0004 keeps the canonical Google Merchant adapter offline. The next phase needs to inspect processed products without acquiring the ability to change them. Google's product `list` and `get` methods require the `https://www.googleapis.com/auth/content` scope, which by itself does not guarantee read-only behavior. The current plan's statement that a human OAuth consent flow is universally required is too broad: Google recommends a service account for one's own business and an OAuth consent flow for third-party applications serving other businesses.

## Decision

- Add a separate server-only client with `listProducts` and `getProduct` as its sole operations. The origin, API version and GET routes are fixed; callers cannot supply URLs, methods, headers, or bodies. Do not add product input methods, registration, persistence or proposal application.
- Inject a short-lived bearer token supplier. Obtaining, refreshing, storing and revoking credentials remain outside this boundary. No tokens or response bodies appear in thrown errors or logs.
- Treat Merchant responses as untrusted. Return a validated minimal projection of processed products, scoped to the requested account; no automatic pagination or background sync.
- Retain the offline adapter's no-network rules. A distinct module implements the transport so the existing preview boundary stays intact.
- Start with own-account service account authentication at deployment, subject to verifying the Merchant account's role and Google Cloud registration. If this becomes a multi-merchant product, design OAuth consent and token storage separately.

## Security and release gates

Offline tests must show fixed-origin GET-only requests, rejected malformed inputs and responses, no token leakage in errors, and no write methods. An independent security review and live account setup are required before connecting a real account. The account ID, registered project, account role, quotas, execution environment and credential custody are still unknown; this ADR does not claim a live connection exists.

## Sources

- https://developers.google.com/merchant/api/guides/quickstart/authentication
- https://developers.google.com/merchant/api/guides/quickstart/registration
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/get
