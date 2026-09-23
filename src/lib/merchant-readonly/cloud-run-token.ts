/** Keyless Merchant token supplier for a Cloud Run service with the reader identity attached. */
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcontent";
const METADATA_EMAIL_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email";
const SERVICE_ACCOUNT_EMAIL = /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;

export function createCloudRunMerchantTokenProvider(expectedServiceAccountEmail: string, fetcher: typeof fetch = fetch): () => Promise<string> {
  if (typeof window !== "undefined") throw new Error("Merchant credentials are server-only");
  if (!SERVICE_ACCOUNT_EMAIL.test(expectedServiceAccountEmail)) throw new Error("Invalid Merchant service identity");

  return async () => {
    // Fail closed outside Cloud Run; a local developer must never silently use their ADC.
    if (!process.env.K_SERVICE && !process.env.CLOUD_RUN_JOB) throw new Error("Merchant authentication unavailable");

    try {
      const options: RequestInit = {
        method: "GET",
        headers: { "Metadata-Flavor": "Google" },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      };
      const identity = await fetcher(METADATA_EMAIL_URL, options);
      if (!identity.ok || (await identity.text()).trim() !== expectedServiceAccountEmail) {
        throw new Error("Unexpected service identity");
      }
      const response = await fetcher(METADATA_TOKEN_URL, options);
      if (!response.ok) throw new Error("Metadata request failed");
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("Invalid metadata response");
      const token = (body as Record<string, unknown>).access_token;
      if (typeof token !== "string" || !token || token.length > 8192 || /[\s\x00-\x1f\x7f]/.test(token)) {
        throw new Error("Invalid metadata token");
      }
      if ((body as Record<string, unknown>).token_type !== "Bearer") throw new Error("Invalid token type");
      return token;
    } catch {
      // Do not forward metadata errors, access tokens or response bodies to callers or logs.
      throw new Error("Merchant authentication unavailable");
    }
  };
}
