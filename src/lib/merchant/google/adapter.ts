// A pure facade for the fixture-only mapper and proposal preview.
import { mapOffer, mapOffers } from "./mapper";
import { toFeedUpdateProposal, type PreviewMeta } from "./proposal";
import type { BatchMapResult, MapOfferResult, MappedOffer, MerchantOfferInput } from "./types";
import type { ProposalCreateInput } from "@/lib/schema/proposal";

export interface GoogleMerchantAdapter {
  mapOffer(input: MerchantOfferInput): MapOfferResult;
  mapOffers(inputs: readonly MerchantOfferInput[]): BatchMapResult;
  toFeedUpdateProposal(offer: MappedOffer, meta?: PreviewMeta): ProposalCreateInput;
}

export function createGoogleMerchantAdapter(): GoogleMerchantAdapter {
  return { mapOffer, mapOffers, toFeedUpdateProposal };
}
