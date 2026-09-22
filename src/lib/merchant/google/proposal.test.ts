import { describe, expect, it } from "vitest";
import { ProposalCreateInputSchema } from "@/lib/schema/proposal";
import { makeOffer } from "./__fixtures__/records";
import { mapOffer } from "./mapper";
import { toFeedUpdateProposal } from "./proposal";

function mappedOffer() {
  const result = mapOffer(makeOffer());
  if (result.status !== "mapped") throw new Error("fixture must map");
  return result;
}

describe("toFeedUpdateProposal", () => {
  it("creates a validated pending-by-default feed update input", () => {
    const mapped = mappedOffer();
    const proposal = toFeedUpdateProposal(mapped, { rationaleContext: "Initial catalogue preview" });

    expect(ProposalCreateInputSchema.safeParse(proposal).success).toBe(true);
    expect(proposal).toMatchObject({
      type: "feed_update",
      targetEntity: "google_merchant_product_input",
      targetId: mapped.productInputId,
      before: { state: "absent" },
      after: mapped.productInput,
      createdBy: "system",
    });
    expect(proposal).not.toHaveProperty("status");
    expect(proposal).not.toHaveProperty("decidedBy");
    expect(proposal).not.toHaveProperty("decidedAt");
  });

  it("uses the supplied prior payload as the before snapshot", () => {
    const mapped = mappedOffer();
    const before = {
      ...structuredClone(mapped.productInput),
      productAttributes: {
        ...structuredClone(mapped.productInput.productAttributes),
        title: "Previous title",
      },
    };

    expect(toFeedUpdateProposal(mapped, { before }).before).toEqual(before);
  });

  it("never emits a bare null before snapshot", () => {
    const mapped = mappedOffer();
    expect(toFeedUpdateProposal(mapped, {}).before).toEqual({ state: "absent" });
    expect(() => toFeedUpdateProposal(mapped, { before: null } as never)).toThrow(
      "before must be a Merchant payload or omitted",
    );
  });

  it("rejects skipped, invalid, or malformed values at the runtime boundary", () => {
    const skipped = mapOffer(makeOffer({ product: { status: "draft" } }));
    const invalid = mapOffer(makeOffer({ product: { title: "" } }));

    expect(() => toFeedUpdateProposal(skipped as never, {})).toThrow(
      "only a mapped Merchant offer can become a proposal preview",
    );
    expect(() => toFeedUpdateProposal(invalid as never, {})).toThrow(
      "only a mapped Merchant offer can become a proposal preview",
    );
    expect(() => toFeedUpdateProposal(mappedOffer(), { before: { offerId: "x" } } as never)).toThrow(
      "before must be a Merchant payload or omitted",
    );
  });

  it("generates a deterministic explanation of mapped fields and warnings", () => {
    const mapped = mapOffer(makeOffer({ product: { brand: undefined } }));
    if (mapped.status !== "mapped") throw new Error("fixture must map");

    const first = toFeedUpdateProposal(mapped, { rationaleContext: "  Seasonal refresh  " });
    const second = toFeedUpdateProposal(mapped, { rationaleContext: "Seasonal refresh" });

    expect(first.rationale).toBe(second.rationale);
    expect(first.rationale).toContain("Seasonal refresh");
    expect(first.rationale).toContain("productAttributes.title");
    expect(first.rationale).toContain("gtin_without_brand:variant.gtin");
    expect(first.rationale).not.toContain(mapped.productInput.productAttributes.description);
    expect(first.rationale).not.toContain(mapped.productInput.productAttributes.link);
  });

  it("does not mutate the mapped offer, its payload, warnings, or prior snapshot", () => {
    const mapped = mappedOffer();
    const before = structuredClone(mapped.productInput);
    const offerJson = JSON.stringify(mapped);
    const beforeJson = JSON.stringify(before);

    toFeedUpdateProposal(mapped, { before, rationaleContext: "Preview" });

    expect(JSON.stringify(mapped)).toBe(offerJson);
    expect(JSON.stringify(before)).toBe(beforeJson);
  });
});
