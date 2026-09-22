import { describe, expect, it } from "vitest";
import { makeOffer } from "./__fixtures__/records";
import { createGoogleMerchantAdapter } from "./adapter";

describe("createGoogleMerchantAdapter", () => {
  it("exposes the three pure Slice 3 operations", () => {
    const adapter = createGoogleMerchantAdapter();
    expect(Object.keys(adapter).sort()).toEqual(["mapOffer", "mapOffers", "toFeedUpdateProposal"]);
    expect(Object.isFrozen(adapter)).toBe(true);
  });

  it("maps an offer and turns only a mapped result into a proposal preview", () => {
    const adapter = createGoogleMerchantAdapter();
    const result = adapter.mapOffer(makeOffer());
    expect(result.status).toBe("mapped");
    if (result.status !== "mapped") return;

    const proposal = adapter.toFeedUpdateProposal(result, {});
    expect(proposal.type).toBe("feed_update");
    expect(proposal.targetId).toBe(result.productInputId);
    expect(proposal.after).toEqual(result.productInput);
  });

  it("keeps batch mapping behavior identical to the standalone mapper", () => {
    const adapter = createGoogleMerchantAdapter();
    const offers = [makeOffer(), makeOffer({ product: { status: "draft" }, variant: { sku: "DRAFT-1" } })];
    const batch = adapter.mapOffers(offers);
    expect(batch.mapped).toHaveLength(1);
    expect(batch.skipped).toHaveLength(1);
    expect(batch.invalid).toHaveLength(0);
  });
});
