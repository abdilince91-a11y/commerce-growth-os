import { describe, expect, it, vi } from "vitest";
import { createMerchantReadClient } from "./client";

const name = "accounts/123/products/en~US~sku-1";
const product = { name, base64EncodedName: "accounts/123/products/ZW5-VVN-c2t1LTE", offerId: "sku-1", productAttributes: { title: "Shirt" } };

function setup(response: Response = Response.json({ products: [product], nextPageToken: "next" })) {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toMatch(/^https:\/\/merchantapi\.googleapis\.com\/products\/v1\//);
    expect(init.method).toBe("GET");
    return response;
  });
  const getAccessToken = vi.fn(async () => "private-token");
  return { client: createMerchantReadClient({ accountId: "123", fetcher, getAccessToken }), fetcher, getAccessToken };
}

describe("Merchant processed-product read client", () => {
  it("lists one page using only a fixed Google GET endpoint", async () => {
    const { client, fetcher } = setup();
    expect(await client.listProducts("123", { pageSize: 10, pageToken: "a/b+c" })).toEqual({
      products: [{ name, base64EncodedName: product.base64EncodedName, offerId: "sku-1", title: "Shirt" }],
      nextPageToken: "next",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://merchantapi.googleapis.com/products/v1/accounts/123/products?pageSize=10&pageToken=a%2Fb%2Bc");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", headers: { Authorization: "Bearer private-token" } });
    expect(Object.keys(client).sort()).toEqual(["getProduct", "listProducts"]);
  });

  it("gets only a resource in the requested account", async () => {
    const { client, fetcher } = setup(Response.json(product));
    expect((await client.getProduct("123", product.base64EncodedName)).title).toBe("Shirt");
    expect(fetcher.mock.calls[0]![0]).toBe("https://merchantapi.googleapis.com/products/v1/accounts/123/products/ZW5-VVN-c2t1LTE");
  });

  it("keeps decoded offer IDs in data and uses the encoded name for a subsequent get", async () => {
    const special = { ...product, name: "accounts/123/products/en~US~sku/1", base64EncodedName: "accounts/123/products/ZW5-VVN-c2t1LzE" };
    const listed = setup(Response.json({ products: [special] }));
    expect((await listed.client.listProducts("123")).products[0]?.name).toBe(special.name);
    const fetched = setup(Response.json(special));
    expect((await fetched.client.getProduct("123", special.base64EncodedName)).name).toBe(special.name);
    expect(fetched.fetcher.mock.calls[0]![0]).not.toContain("sku/1");
  });

  it("rejects injected paths, invalid pagination, and foreign accounts without fetching", async () => {
    const { client, fetcher, getAccessToken } = setup();
    await expect(client.listProducts("123/evil")).rejects.toThrow("Invalid Merchant account ID");
    await expect(client.listProducts("123", { pageSize: 1001 })).rejects.toThrow("Invalid page size");
    await expect(client.listProducts("123", { pageToken: "" })).rejects.toThrow("Invalid page token");
    await expect(client.getProduct("123", "accounts/456/products/en~US~sku")).rejects.toThrow("Invalid product name");
    await expect(client.getProduct("123", "accounts/123/products/../evil")).rejects.toThrow("Invalid product name");
    await expect(client.listProducts("456")).rejects.toThrow("Invalid Merchant account ID");
    await expect(client.getProduct("456", "accounts/456/products/en~US~sku")).rejects.toThrow("Invalid Merchant account ID");
    expect(fetcher).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("rejects an invalid bound account before creating a client", () => {
    expect(() => createMerchantReadClient({
      accountId: "123/evil",
      getAccessToken: async () => "token",
      fetcher: async () => Response.json({}),
    })).toThrow("Invalid Merchant account ID");
  });

  it("rejects malformed responses and never includes tokens or upstream bodies in errors", async () => {
    const { client } = setup(new Response("private-token upstream details", { status: 403 }));
    await expect(client.listProducts("123")).rejects.toThrow("Merchant API request failed (403)");
    const broken = setup(Response.json({ products: [{ ...product, name: "accounts/456/products/en~US~sku" }] }));
    await expect(broken.client.listProducts("123")).rejects.toThrow("Invalid Merchant API response");
  });

  it("rejects invalid token and does not issue a request", async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("/products/");
      expect(init.method).toBe("GET");
      return Response.json(product);
    });
    const client = createMerchantReadClient({ accountId: "123", fetcher, getAccessToken: async () => "bad\r\ntoken" });
    await expect(client.getProduct("123", name)).rejects.toThrow("Merchant authentication unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
