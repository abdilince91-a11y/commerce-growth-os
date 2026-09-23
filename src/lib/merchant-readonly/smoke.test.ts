import { afterEach, describe, expect, it, vi } from "vitest";
import { probeMerchantReadOnly } from "../../../scripts/merchant-readonly-smoke";

const reader = "merchant-reader@example-project.iam.gserviceaccount.com";
afterEach(() => vi.unstubAllEnvs());

describe("one-shot Merchant read probe", () => {
  it("stops before network access without a configured Cloud Run job", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(probeMerchantReadOnly({ GOOGLE_MERCHANT_ACCOUNT_ID: "123", GOOGLE_MERCHANT_READER_EMAIL: reader }, fetcher))
      .rejects.toThrow("Merchant probe configuration unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("performs one scoped metadata token request and one Merchant GET without logging product data", async () => {
    vi.stubEnv("CLOUD_RUN_JOB", "merchant-smoke");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(reader))
      .mockResolvedValueOnce(Response.json({ access_token: "secret-token", token_type: "Bearer" }))
      .mockResolvedValueOnce(Response.json({ products: [{ name: "accounts/123/products/en~US~secret-sku", offerId: "secret-sku" }] }));
    const report = vi.fn();
    await probeMerchantReadOnly({ CLOUD_RUN_JOB: "merchant-smoke", GOOGLE_MERCHANT_ACCOUNT_ID: "123", GOOGLE_MERCHANT_READER_EMAIL: reader }, fetcher, report);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]![0]).toBe("https://merchantapi.googleapis.com/products/v1/accounts/123/products?pageSize=1");
    expect(fetcher.mock.calls[2]![1]).toMatchObject({ method: "GET", redirect: "error" });
    expect(report).toHaveBeenCalledWith("Merchant read-only probe succeeded (returned 1 product).");
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/secret-sku|secret-token/);
  });

  it("does not log access tokens or upstream bodies on failure", async () => {
    vi.stubEnv("CLOUD_RUN_JOB", "merchant-smoke");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(reader))
      .mockResolvedValueOnce(Response.json({ access_token: "secret-token", token_type: "Bearer" }))
      .mockResolvedValueOnce(new Response("secret-merchant-body", { status: 403 }));
    const report = vi.fn();
    await expect(probeMerchantReadOnly({ CLOUD_RUN_JOB: "merchant-smoke", GOOGLE_MERCHANT_ACCOUNT_ID: "123", GOOGLE_MERCHANT_READER_EMAIL: reader }, fetcher, report))
      .rejects.toThrow("Merchant API request failed (403)");
    expect(report).not.toHaveBeenCalled();
  });
});
