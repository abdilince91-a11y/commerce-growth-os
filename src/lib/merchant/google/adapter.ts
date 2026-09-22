// Transport-free Google Merchant adapter facade. Every operation is pure.

import type { ProposalCreateInput } from "@/lib/schema/proposal";
import { mapOffer, mapOffers } from "./mapper";
import { toFeedUpdateProposal, type PreviewMeta } from "./proposal";
import type {
  BatchMapResult,
  MapOfferResult,
  MappedOffer,
  MerchantOfferInput,
} from "./types";

export interface GoogleMerchantAdapter {
  readonly mapOffer: (input: MerchantOfferInput) => MapOfferResult;
  readonly mapOffers: (inputs: readonly MerchantOfferInput[]) => BatchMapResult;
  readonly toFeedUpdateProposal: (
    offer: MappedOffer,
    meta: PreviewMeta,
  ) => ProposalCreateInput;
}

const ADAPTER: GoogleMerchantAdapter = Object.freeze({
  mapOffer,
  mapOffers,
  toFeedUpdateProposal,
});

export function createGoogleMerchantAdapter(): GoogleMerchantAdapter {
  return ADAPTER;
}
