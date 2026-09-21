import { describe, expect, it } from "vitest";
import { mapOffer } from "./mapper";
import { toFeedUpdateProposal } from "./proposal";
import { createGoogleMerchantAdapter } from "./adapter";
import { makeOffer } from "./__fixtures__/records";

function mapped() {
  const result = mapOffer(makeOffer());
  if (result.status !== "mapped") throw new Error("fixture must map");
  return result;
}

describe("proposal preview", () => {
  it("makes one validated, deterministic proposal input for a mapped offer", () => {
    const offer = mapped();
    const proposal = toFeedUpdateProposal(offer);
    expect(proposal).toEqual(toFeedUpdateProposal(offer));
    expect(proposal).toMatchObject({
      type: "feed_update",
      targetEntity: "google_merchant_product_input",
      targetId: offer.productInputId,
      before: { state: "absent" },
      after: offer.productInput,
      createdBy: "system",
    });
    expect(proposal.rationale).toContain("Variant.sku");
    expect(proposal).not.toHaveProperty("status");
    expect(proposal).not.toHaveProperty("decidedBy");
  });

  it("uses an existing payload as before without changing it", () => {
    const offer = mapped();
    const prior = { ...offer.productInput, offerId: "OLD-SKU" };
    const proposal = toFeedUpdateProposal(offer, { before: prior });
    expect(proposal.before).toBe(prior);
    expect(proposal.after).toBe(offer.productInput);
  });

  it("rejects skipped or invalid mapping results even when called from JS", () => {
    const skipped = mapOffer(makeOffer({ variant: { status: "draft" } }));
    const invalid = mapOffer(makeOffer({ link: "javascript:alert(1)" }));
    expect(() => toFeedUpdateProposal(skipped as never)).toThrow("a mapped offer is required");
    expect(() => toFeedUpdateProposal(invalid as never)).toThrow("a mapped offer is required");
  });

  it("exposes only pure mapping and preview methods on the adapter", () => {
    const adapter = createGoogleMerchantAdapter();
    expect(Object.keys(adapter).sort()).toEqual(["mapOffer", "mapOffers", "toFeedUpdateProposal"]);
    const result = adapter.mapOffer(makeOffer());
    if (result.status !== "mapped") throw new Error("fixture must map");
    expect(adapter.toFeedUpdateProposal(result)).toEqual(toFeedUpdateProposal(result));
  });
});
