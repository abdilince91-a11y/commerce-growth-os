# Merchant Center read-only connection — implementation plan

Status: draft transport implemented; account activation pending (2026-09-23). See ADR 0005.

## Scope

1. Keep the offline preview adapter and its no-network lint boundary intact.
2. Add a separate server-side Merchant API v1 client with exactly two methods: list processed products (one page) and get one processed product. Bind it to one runtime account ID; reject other account IDs before obtaining a token. Inject an access-token provider and HTTP implementation; hard-code the Google API origin and GET routes.
3. Validate account identifiers, page sizes/tokens, response shapes and resource names. Do not return raw remote error bodies or tokens in errors. Add offline tests for method, destination, authorization, pagination, malformed responses, and absence of write methods.
4. Record account setup, permissions, auth choice and security review in ADR 0005. No Cloud registration, credentials, account access, token storage, database, UI, or write endpoints in this slice.
5. Run tests, typecheck, lint, build, audit and inspect the diff. Publish for review only after verification.

## Account activation prerequisites

- The owner reports an existing Merchant account with verified site, a dedicated Cloud project with Merchant API enabled, and a service account created without project roles or a JSON key. These setup statements are not proof of developer registration or a successful API call; do not place the account and project identifiers in the source tree.
- For the one-time `registerGcp` call, use an existing Merchant `ADMIN` identity with credentials issued from the dedicated project. A project-bound user OAuth flow is preferred here so the long-running reader never needs `ADMIN`. Developer contact must be a real Google account able to receive API notices, not the service account. No registration or live request is implemented by this draft.
- After registration, grant the application's service account `READ_ONLY` in Merchant Center and verify a harmless list/get request. The REST `accounts.users` reference documents `READ_ONLY` for read methods, but Google's quickstart FAQ claims `ADMIN` is required even for subsequent API calls. Resolve the discrepancy by testing with `READ_ONLY`; if Google rejects it, stop and review the access model rather than widening the reader's role.
- Choose the deployment environment and keyless identity method before implementing the token supplier. Never commit, upload to chat, or paste a JSON private key or access token. Do not add a production route or perform a live connection until an independent security review and explicit runtime configuration are complete.

## Sources

- https://developers.google.com/merchant/api/guides/quickstart/authentication
- https://developers.google.com/merchant/api/guides/quickstart/registration
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/get
- https://developers.google.com/merchant/api/reference/rest/accounts_v1/accounts.users
- https://developers.google.com/merchant/api/guides/quickstart/faq
