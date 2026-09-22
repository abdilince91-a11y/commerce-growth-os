export { createGoogleMerchantAdapter, type GoogleMerchantAdapter } from "./adapter";
export {
  createIssue,
  errorsOf,
  hasErrors,
  issueFromFailure,
  safeOfferId,
  summarizeIssues,
  warningsOf,
  type IssueSummary,
  type IssueSummaryEntry,
  type MerchantIssue,
  type MerchantIssueCode,
  type MerchantIssueSeverity,
} from "./errors";
export { validateGtin } from "./gtin";
export {
  buildProductInputId,
  validateContentLanguage,
  validateFeedLabel,
  validateOfferId,
} from "./identifiers";
export { mapOffer, mapOffers } from "./mapper";
export {
  SUPPORTED_CURRENCIES,
  currencyExponent,
  decimalStringToMicros,
  minorUnitsToMicros,
  validateCurrency,
  type SupportedCurrency,
} from "./money";
export { toFeedUpdateProposal, type PreviewMeta } from "./proposal";
export {
  DESCRIPTION_MAX_CODE_POINTS,
  TITLE_MAX_CODE_POINTS,
  countCodePoints,
  hasLoneSurrogate,
  normalizeBoundedText,
  normalizeText,
} from "./text";
export type {
  BatchMapResult,
  InvalidOffer,
  MapOfferResult,
  MappedOffer,
  MerchantChannelConfig,
  MerchantOfferInput,
  MerchantProductAttributes,
  MerchantProductInput,
  MerchantPrice,
  SkippedOffer,
} from "./types";
export { validateHttpUrl } from "./urls";
