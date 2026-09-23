# Merchant Center read-only connection — implementation plan

Status: draft transport implemented; owner reported successful one-time project registration and manual read-only live GET (2026-09-23). A separate Cloud Run token supplier has offline tests; deployment, an application live GET and independent security review remain pending. See ADR 0005.

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

## Cloud Run token supplier (offline preparation)

- `src/lib/merchant-readonly/cloud-run-token.ts` checks the attached Cloud Run service identity against an expected service-account email before requesting a short-lived OAuth access token from the Cloud Run metadata server with the `https://www.googleapis.com/auth/content` scope. It requires the Cloud Run `K_SERVICE` runtime marker, fixes the metadata endpoints, rejects redirects, times out after five seconds and hides response bodies and tokens in errors. No JSON key or user ADC is used.
- For deployment, attach the already verified read-only Merchant service account as the Cloud Run service identity. Supply the Merchant account ID and expected service-account email through runtime configuration to construct `createMerchantReadClient({ accountId, getAccessToken: createCloudRunMerchantTokenProvider(expectedServiceAccountEmail), fetcher: fetch })` on the server. This is a recipe, not a deployed service or an endpoint; no account ID, product data or credential is embedded in code.
- Keep Cloud Run invocations private and complete an independent security review of both modules before wiring an application route or making an application-originated live GET. The earlier manual GET tested a different token issuance path; metadata scope behavior and a real runtime read remain unverified in the deployed environment.
- The read-only Merchant role is the effective protection against writes. The OAuth `content` scope is broader than read-only; any code running under the attached identity can request tokens, so runtime isolation and review matter.

## Private one-shot runtime verification (prepared, not deployed)

- `scripts/merchant-readonly-smoke.ts` runs as a Cloud Run **job**, not a public web endpoint. It requires `CLOUD_RUN_JOB`, a runtime Merchant account ID and an expected reader service-account email. It checks the attached identity, requests a token, makes a single `products.list?pageSize=1` GET and logs only the number of returned products. On failure it emits a fixed message and exits unsuccessfully; it never logs product data, an upstream response body or a token.
- `Dockerfile.merchant-smoke` packages just the script and the two read modules with Node 22.18. `cloudbuild.merchant-smoke.yaml` builds that image with a caller-provided `_IMAGE` value. The Node.js container requires no downloaded service-account key or npm runtime installation.
- For the owner-authorized one-time check, build an image in a private Artifact Registry repository, create a Cloud Run job with `--tasks=1 --max-retries=0 --task-timeout=60s --service-account=READER_EMAIL`, and supply only `GOOGLE_MERCHANT_ACCOUNT_ID` and `GOOGLE_MERCHANT_READER_EMAIL` as runtime settings. Execute it once with `gcloud run jobs execute JOB --region REGION --wait` and inspect the one-line result. Creating/building/executing cloud resources can incur charges; confirm the project has billing and deploy permissions before running commands. Do not create a public Cloud Run service for this test. Independent security review remains required before merging or scheduling regular execution.
- Cloud Run jobs set `CLOUD_RUN_JOB`, whereas services set `K_SERVICE`. The provider accepts either runtime marker and refuses to contact metadata outside Cloud Run. Local tests prove the job code path with injected HTTP responses. GitHub CI also builds the dedicated container and checks that it fails closed outside Cloud Run. A live Cloud Run execution remains unverified.
- The optional Windows `scripts/run-merchant-cloud-probe.ps1` checks a clean checkout, signed-in Cloud project, reader service account, enabled APIs, billing and existing jobs before building. It uploads only six explicitly copied source/build files from a temporary directory, creates a private Artifact Registry repository if necessary, creates a one-task/zero-retry/60-second Cloud Run job with the read-only identity, and waits for one execution. Run it after checking the draft PR diff and authenticating `gcloud.cmd` locally. No Cloud command was run from this repository workspace.

## Sources

- https://developers.google.com/merchant/api/guides/quickstart/authentication
- https://developers.google.com/merchant/api/guides/quickstart/registration
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/list
- https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products/get
- https://developers.google.com/merchant/api/reference/rest/accounts_v1/accounts.users
- https://developers.google.com/merchant/api/guides/quickstart/faq
- https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken
- https://docs.cloud.google.com/run/docs/securing/service-identity
- https://docs.cloud.google.com/kubernetes-engine/enterprise/knative-serving/docs/securing/service-identity
- https://docs.cloud.google.com/run/docs/container-contract
- https://docs.cloud.google.com/run/docs/create-jobs
- https://docs.cloud.google.com/run/docs/execute/jobs
