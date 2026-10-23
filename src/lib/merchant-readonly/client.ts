/** Merchant API v1 processed products: a read-only transport, separate from preview mapping. */
export type MerchantProductView = Readonly<{
  name: string;
  base64EncodedName?: string;
  offerId?: string;
  title?: string;
  availability?: string;
}>;

export type MerchantReadClient = Readonly<{
  listProducts(accountId: string, options?: { pageSize?: number; pageToken?: string }): Promise<{
    products: MerchantProductView[];
    nextPageToken?: string;
  }>;
  getProduct(accountId: string, productName: string): Promise<MerchantProductView>;
}>;

export type MerchantReadDependencies = Readonly<{
  /** The one Merchant account this client is allowed to read. */
  accountId: string;
  getAccessToken(): Promise<string>;
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
}>;

const API = "https://merchantapi.googleapis.com/products/v1/";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const ACCOUNT_ID = /^[0-9]{1,32}$/;
const SEGMENT = /^[A-Za-z0-9_~-]{1,512}$/;

function parentFor(accountId: string): string {
  if (!ACCOUNT_ID.test(accountId)) throw new Error("Invalid Merchant account ID");
  return `accounts/${accountId}/products`;
}

function productNameFor(parent: string, productName: string): string {
  const prefix = `${parent}/`;
  if (!productName.startsWith(prefix) || !SEGMENT.test(productName.slice(prefix.length))) {
    throw new Error("Invalid product name");
  }
  return productName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Invalid Merchant API response");
  return value;
}

/** Count streamed bytes before decoding/parsing; Content-Length is only a hint. */
async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("Invalid Merchant API response");
  }
  if (!response.body) throw new Error("Invalid Merchant API response");
  const reader = response.body.getReader();
  const buffer = new Uint8Array(MAX_RESPONSE_BYTES);
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > MAX_RESPONSE_BYTES - bytes) throw new Error("Invalid Merchant API response");
      buffer.set(value, bytes);
      bytes += value.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes));
    return JSON.parse(text) as unknown;
  } catch {
    // Do not let cancellation failure replace the static public error.
    void reader.cancel().catch(() => undefined);
    throw new Error("Invalid Merchant API response");
  } finally {
    reader.releaseLock();
  }
}

function parseProduct(value: unknown, parent: string): MerchantProductView {
  if (!isRecord(value) || typeof value.name !== "string") throw new Error("Invalid Merchant API response");
  // The response may contain a decoded offerId with a slash. Only the
  // base64EncodedName (or a simple plain name) may become a request path.
  const suffix = value.name.slice(parent.length + 1);
  if (!value.name.startsWith(`${parent}/`) || !suffix || suffix.length > 2048 || /[\x00-\x1f\x7f]/.test(suffix)) {
    throw new Error("Invalid Merchant API response");
  }
  const encoded = optionalString(value, "base64EncodedName");
  if (encoded) {
    try { productNameFor(parent, encoded); } catch { throw new Error("Invalid Merchant API response"); }
  }
  const attributes = value.productAttributes;
  if (attributes !== undefined && !isRecord(attributes)) throw new Error("Invalid Merchant API response");
  const offerId = optionalString(value, "offerId");
  const title = attributes ? optionalString(attributes, "title") : undefined;
  const availability = attributes ? optionalString(attributes, "availability") : undefined;
  return {
    name: value.name,
    ...(encoded !== undefined && { base64EncodedName: encoded }),
    ...(offerId !== undefined && { offerId }),
    ...(title !== undefined && { title }),
    ...(availability !== undefined && { availability }),
  };
}

/** The caller supplies an ephemeral token provider. Neither credentials nor transport are exported. */
export function createMerchantReadClient(dependencies: MerchantReadDependencies): MerchantReadClient {
  if (typeof window !== "undefined") throw new Error("Merchant read client is server-only");
  const boundParent = parentFor(dependencies.accountId);
  function checkedParent(accountId: string): string {
    const parent = parentFor(accountId);
    if (parent !== boundParent) throw new Error("Invalid Merchant account ID");
    return parent;
  }
  async function request(path: string, query?: URLSearchParams): Promise<unknown> {
    let token: string;
    try { token = await dependencies.getAccessToken(); } catch { throw new Error("Merchant authentication unavailable"); }
    if (!token || token.length > 8192 || /[\s\x00-\x1f\x7f]/.test(token)) {
      throw new Error("Merchant authentication unavailable");
    }
    const url = `${API}${path}${query?.size ? `?${query}` : ""}`;
    let response: Response;
    try {
      response = await dependencies.fetcher(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch { throw new Error("Merchant API request failed"); }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`Merchant API request failed (${response.status})`);
    }
    try { return await readBoundedJson(response); } catch { throw new Error("Invalid Merchant API response"); }
  }

  return Object.freeze({
    async listProducts(accountId: string, options: { pageSize?: number; pageToken?: string } = {}) {
      const parent = checkedParent(accountId);
      if (options.pageSize !== undefined && (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 1000)) {
        throw new Error("Invalid page size");
      }
      if (options.pageToken !== undefined && (!options.pageToken || options.pageToken.length > 4096)) {
        throw new Error("Invalid page token");
      }
      const query = new URLSearchParams();
      if (options.pageSize !== undefined) query.set("pageSize", String(options.pageSize));
      if (options.pageToken !== undefined) query.set("pageToken", options.pageToken);
      const result = await request(parent, query);
      if (!isRecord(result) || (result.products !== undefined && !Array.isArray(result.products))) {
        throw new Error("Invalid Merchant API response");
      }
      const nextPageToken = optionalString(result, "nextPageToken");
      if (nextPageToken !== undefined && nextPageToken.length > 4096) throw new Error("Invalid Merchant API response");
      if (Array.isArray(result.products) && result.products.length > 1000) throw new Error("Invalid Merchant API response");
      return {
        products: (result.products ?? []).map((item: unknown) => parseProduct(item, parent)),
        ...(nextPageToken !== undefined && { nextPageToken }),
      };
    },
    async getProduct(accountId: string, productName: string) {
      const parent = checkedParent(accountId);
      const name = productNameFor(parent, productName);
      const product = parseProduct(await request(name), parent);
      if (product.name !== name && product.base64EncodedName !== name) {
        throw new Error("Invalid Merchant API response");
      }
      return product;
    },
  });
}
