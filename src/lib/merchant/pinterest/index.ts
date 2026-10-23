import { mapOffer, mapOffers } from "./mapper";
import { createCatalogPreview } from "./catalog";
import { toFeedUpdateProposal } from "./proposal";

export { mapOffer, mapOffers, createCatalogPreview, toFeedUpdateProposal };
export type { PinterestOfferInput, PinterestCatalogItem, PinterestOfferResult, PinterestMappedOffer, PinterestBatchResult, PinterestCatalogPreview, PinterestIssue } from "./types";
const ADAPTER = Object.freeze({ mapOffer, mapOffers, createCatalogPreview, toFeedUpdateProposal });
export function createPinterestCatalogAdapter() { return ADAPTER; }
