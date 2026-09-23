/** Keyless Merchant token supplier for a Cloud Run service with the reader identity attached. */
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcontent";

export function createCloudRunMerchantTokenProvider(fetcher: typeof fetch = fetch): () => Promise<string> {
  if (typeof window !== "undefined") throw new Error("Merchant credentials are server-only");

  return async () => {
    // Fail closed outside Cloud Run; a local developer must never silently use their ADC.
    if (!process.env.K_SERVICE) throw new Error("Merchant authentication unavailable");

    try {
      const response = await fetcher(METADATA_TOKEN_URL, {
        method: "GET",
        headers: { "Metadata-Flavor": "Google" },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
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
