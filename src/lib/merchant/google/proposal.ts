// Pure proposal preview: no persistence, transport, or status transition.
import { ProposalCreateInputSchema, type ProposalCreateInput } from "@/lib/schema/proposal";
import type { MappedOffer, MerchantProductInput } from "./types";

export interface PreviewMeta {
  // An existing Merchant payload, when the caller has one. Absence is an
  // explicit JSON sentinel because Proposal.before cannot store bare null.
  readonly before?: MerchantProductInput;
  readonly rationaleContext?: string;
}

const ABSENT = { state: "absent" } as const;

// Keep the explanation reproducible and avoid copying product descriptions,
// URLs, or other raw product values into the rationale.
export function toFeedUpdateProposal(
  offer: MappedOffer,
  meta: PreviewMeta = {},
): ProposalCreateInput {
  if (offer.status !== "mapped") {
    throw new TypeError("a mapped offer is required");
  }
  const context = meta.rationaleContext?.trim();
  const rationale = [
    "Preview derived from canonical Product and Variant records.",
    "Variant.sku maps to offerId; Product.id maps to itemGroupId.",
    "Channel configuration supplies contentLanguage and feedLabel; storefront context supplies link.",
    "Variant price, availability and identifiers and Product content supply productAttributes.",
    ...(offer.warnings.length > 0
      ? [`Mapping warnings: ${offer.warnings.map((warning) => warning.code).join(", ")}.`]
      : []),
    ...(context ? [context] : []),
  ].join(" ");

  return ProposalCreateInputSchema.parse({
    type: "feed_update",
    targetEntity: "google_merchant_product_input",
    targetId: offer.productInputId,
    before: meta.before ?? ABSENT,
    after: offer.productInput,
    rationale,
    createdBy: "system",
  });
}
