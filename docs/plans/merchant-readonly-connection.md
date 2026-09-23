# Merchant Center read-only connection — implementation plan

Status: draft transport implemented; owner reported successful one-time project registration and manual read-only live GET (2026-09-23). Application runtime integration and independent security review remain pending. See ADR 0005.

## Scope

1. Keep the offline preview adapter and its no-network lint boundary intact.
2. Add a separate server-side Merchant API v1 client with exactly two methods: list processed products (one page) and get one processed product. Bind it to one runtime account ID; reject other account IDs before obtaining a token. Inject an access-token provider and HTTP implementation; hard-code the Google API origin and GET routes.
3. Validate account identifiers, page sizes/tokens, response shapes and resource names. Do not return raw remote error bodies or tokens in errors. Add offline tests for method, destination, authorization, pagination, malformed responses, and absence of write methods.
4. Record account setup, permissions, auth choice and security review in ADR 0005. No Cloud registration, credentials, account access, token storage, database, UI, or write endpoints in this slice.
5. Run tests, typecheck, lint, build, audit and inspect the diff. Publish for review only after verification.

## Account activation and remaining gates

- The owner confirmed a verified Merchant website, a dedicated Cloud project with Merchant API enabled, and a service account shown in Merchant Center with exactly Read-only and Verified status. No service-account JSON key was created or shared. Account and project identifiers remain outside the source tree.
- The owner performed `registerGcp` once with their existing Merchant administrator account and the dedicated project's desktop OAuth client. The successful response identified the expected Merchant account and Cloud project. The request body was `{}`, so no developer contact or Merchant user role was added by that call. Review the technical-contact requirement separately.
- For manual verification, the owner granted their own Cloud identity `roles/iam.serviceAccountTokenCreator` **on the reader service account only**, enabled the Service Account Credentials API, minted a ten-minute `content`-scoped token by impersonation, and reported `GET products/v1/accounts/{account}/products?pageSize=1` succeeded with one product returned. No product data, access token, OAuth secret, or private key was shared or saved to this repository. This resolves the documented `READ_ONLY` versus `ADMIN` ambiguity for this observed list request; it does not establish `get` behavior or future policy stability.
- The GET was an owner-run PowerShell request, not a call through this repository's client. Select a deployment environment and keyless workload identity method before implementing the injected token supplier. Keep the independent security review and explicit runtime configuration gates before adding a production caller or UI; never commit or upload credentials.

## Sources

- https://developers.google.com/merchant/api/guides/quickstart/authentication
- https://developers.google.com/merchant/api/guides/quickstart/registration
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/get
- https://developers.google.com/merchant/api/reference/rest/accounts_v1/accounts.users
- https://developers.google.com/merchant/api/guides/quickstart/faq
- https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken
