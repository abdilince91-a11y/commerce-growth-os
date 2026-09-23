import { pathToFileURL } from "node:url";
import { createMerchantReadClient } from "../src/lib/merchant-readonly/client.ts";
import { createCloudRunMerchantTokenProvider } from "../src/lib/merchant-readonly/cloud-run-token.ts";

/** One GET, one result count, and no product identifiers or access tokens in output. */
type ProbeEnvironment = Readonly<{
  CLOUD_RUN_JOB?: string;
  GOOGLE_MERCHANT_ACCOUNT_ID?: string;
  GOOGLE_MERCHANT_READER_EMAIL?: string;
}>;

export async function probeMerchantReadOnly(
  env: ProbeEnvironment = process.env as ProbeEnvironment,
  fetcher: typeof fetch = fetch,
  report: (message: string) => void = console.info,
): Promise<void> {
  if (!env.CLOUD_RUN_JOB || !env.GOOGLE_MERCHANT_ACCOUNT_ID || !env.GOOGLE_MERCHANT_READER_EMAIL) {
    throw new Error("Merchant probe configuration unavailable");
  }
  const client = createMerchantReadClient({
    accountId: env.GOOGLE_MERCHANT_ACCOUNT_ID,
    getAccessToken: createCloudRunMerchantTokenProvider(env.GOOGLE_MERCHANT_READER_EMAIL, fetcher),
    fetcher,
  });
  const result = await client.listProducts(env.GOOGLE_MERCHANT_ACCOUNT_ID, { pageSize: 1 });
  report(`Merchant read-only probe succeeded (returned ${result.products.length} product).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  probeMerchantReadOnly().catch(() => {
    console.error("Merchant read-only probe failed.");
    process.exitCode = 1;
  });
}
