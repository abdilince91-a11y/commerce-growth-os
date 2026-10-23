import { ProposalCreateInputSchema, type ProposalCreateInput } from "@/lib/schema/proposal";
import { CatalogItemSchema } from "./validation";
import type { PinterestCatalogItem, PinterestMappedOffer } from "./types";

export function toFeedUpdateProposal(offer: PinterestMappedOffer, before?: PinterestCatalogItem): ProposalCreateInput {
  if (offer?.status !== "mapped") throw new TypeError("Only a mapped Pinterest item can become a proposal");
  const after = CatalogItemSchema.safeParse(offer.item);
  const previous = before === undefined ? undefined : CatalogItemSchema.safeParse(before);
  if (!after.success || (previous && (!previous.success || previous.data.id !== after.data.id))) {
    throw new TypeError("Invalid Pinterest proposal snapshot");
  }
  // Remove explicit undefined optional fields, keeping both snapshots JSON-ready
  // and detached from the caller's objects/arrays.
  const snapshot = (item: PinterestCatalogItem) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
  return ProposalCreateInputSchema.parse({
    type: "feed_update", targetEntity: "pinterest_catalog_item", targetId: after.data.id,
    before: previous?.success ? snapshot(previous.data) : { state: "absent" },
    after: snapshot(after.data), createdBy: "system",
    rationale: `Prepared an offline Pinterest retail catalog preview from canonical fields: ${Object.keys(after.data).sort().join(", ")}. External publication checks remain required.`,
  });
}
