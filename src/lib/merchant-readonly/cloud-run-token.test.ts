import { afterEach, describe, expect, it, vi } from "vitest";
import { createMerchantReadClient } from "./client";
import { createCloudRunMerchantTokenProvider } from "./cloud-run-token";

const reader = "merchant-reader@example-project.iam.gserviceaccount.com";
afterEach(() => vi.unstubAllEnvs());

describe("Cloud Run Merchant token supplier", () => {
  it("fails closed outside Cloud Run without requesting metadata", async () => {
    vi.stubEnv("K_SERVICE", "");
    vi.stubEnv("CLOUD_RUN_JOB", "");
    const fetcher = vi.fn<typeof fetch>();
    await expect(createCloudRunMerchantTokenProvider(reader, fetcher)()).rejects.toThrow("Merchant authentication unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("supports Cloud Run jobs without a service marker", async () => {
    vi.stubEnv("K_SERVICE", "");
    vi.stubEnv("CLOUD_RUN_JOB", "merchant-smoke");
    const metadata = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(reader))
      .mockResolvedValueOnce(Response.json({ access_token: "ephemeral", token_type: "Bearer" }));
    await expect(createCloudRunMerchantTokenProvider(reader, metadata)()).resolves.toBe("ephemeral");
  });

  it("requests only the Merchant scope from the fixed metadata endpoint and supplies a read client", async () => {
    vi.stubEnv("K_SERVICE", "merchant-reader");
    const metadata = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(reader))
      .mockResolvedValueOnce(Response.json({ access_token: "short-lived-token", token_type: "Bearer", expires_in: 3599 }));
    const api = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ products: [] }));
    const provider = createCloudRunMerchantTokenProvider(reader, metadata);
    const client = createMerchantReadClient({ accountId: "123", getAccessToken: provider, fetcher: api });
    expect(await client.listProducts("123", { pageSize: 1 })).toEqual({ products: [] });
    expect(metadata).toHaveBeenCalledTimes(2);
    expect(metadata.mock.calls[0]![0]).toBe("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email");
    const [url, init] = metadata.mock.calls[1]!;
    const parsed = new URL(String(url));
    expect(parsed.origin).toBe("http://metadata.google.internal");
    expect(parsed.pathname).toBe("/computeMetadata/v1/instance/service-accounts/default/token");
    expect(parsed.searchParams.get("scopes")).toBe("https://www.googleapis.com/auth/content");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", headers: { "Metadata-Flavor": "Google" } });
    expect(api.mock.calls[0]![1]).toMatchObject({ method: "GET", headers: { Authorization: "Bearer short-lived-token" } });
  });

  it("rejects a wrongly attached Cloud Run identity before requesting a token", async () => {
    vi.stubEnv("K_SERVICE", "merchant-reader");
    const metadata = vi.fn<typeof fetch>().mockResolvedValue(new Response("default-compute@example-project.iam.gserviceaccount.com"));
    const provider = createCloudRunMerchantTokenProvider(reader, metadata);
    await expect(provider()).rejects.toThrow("Merchant authentication unavailable");
    expect(metadata).toHaveBeenCalledOnce();
    expect(() => createCloudRunMerchantTokenProvider("not-an-email", metadata)).toThrow("Invalid Merchant service identity");
  });

  it("hides metadata errors and secrets and never calls Merchant with malformed tokens", async () => {
    vi.stubEnv("K_SERVICE", "merchant-reader");
    const api = vi.fn<typeof fetch>();
    for (const metadataResponse of [
      new Response("secret-upstream-body", { status: 403 }),
      Response.json({ access_token: "secret\r\ntoken", token_type: "Bearer" }),
      Response.json({ access_token: "secret-token", token_type: "not-bearer" }),
      Response.json({ token_type: "Bearer" }),
    ]) {
      const metadata = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(reader))
        .mockResolvedValueOnce(metadataResponse);
      const client = createMerchantReadClient({ accountId: "123", getAccessToken: createCloudRunMerchantTokenProvider(reader, metadata), fetcher: api });
      await expect(client.listProducts("123")).rejects.toThrow(/^Merchant authentication unavailable$/);
    }
    expect(api).not.toHaveBeenCalled();
  });
});
