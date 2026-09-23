# Merchant Center read-only connection — implementation plan

Status: in progress (2026-09-23). See ADR 0005.

## Scope

1. Keep the offline preview adapter and its no-network lint boundary intact.
2. Add a separate server-side Merchant API v1 client with exactly two methods: list processed products (one page) and get one processed product. Inject an access-token provider and HTTP implementation; hard-code the Google API origin and GET routes.
3. Validate account identifiers, page sizes/tokens, response shapes and resource names. Do not return raw remote error bodies or tokens in errors. Add offline tests for method, destination, authorization, pagination, malformed responses, and absence of write methods.
4. Record account setup, permissions, auth choice and security review in ADR 0005. No Cloud registration, credentials, account access, token storage, database, UI, or write endpoints in this slice.
5. Run tests, typecheck, lint, build, audit and inspect the diff. Publish for review only after verification.

## Account activation prerequisites

- Confirm the actual Merchant Center account ID, verified site, dedicated Cloud project, Merchant API activation and one-time developer registration with Merchant ADMIN access.
- For an in-house account, provision a service-account identity in the deployment environment and grant it the minimum access validated in the real account. A third-party integration needs an OAuth consent flow and token lifecycle design instead.
- Pick a secret/identity facility in the eventual deployment environment; do not commit a private key or token. A real connection smoke test waits for those prerequisites and explicit account configuration.

## Sources

- https://developers.google.com/merchant/api/guides/quickstart/authentication
- https://developers.google.com/merchant/api/guides/quickstart/registration
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/get
