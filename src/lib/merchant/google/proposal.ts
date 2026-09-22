// Pure proposal-preview integration for the Google Merchant adapter.
//
// This module only builds and validates a ProposalCreateInput. It does not
// persist proposals, import the proposal service, or apply a feed change.

import {
  ProposalCreateInputSchema,
  type ProposalCreateInput,
} from "@/lib/schema/proposal";
import type { MappedOffer, MerchantProductInput } from "./types";

export interface PreviewMeta {
  readonly before?: MerchantProductInput;
  readonly rationaleContext?: string;
}

const ABSENT_SNAPSHOT = { state: "absent" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMerchantProductInput(value: unknown): value is MerchantProductInput {
  return (
    isRecord(value) &&
    typeof value.offerId === "string" &&
    typeof value.contentLanguage === "string" &&
    typeof value.feedLabel === "string" &&
    isRecord(value.productAttributes)
  );
}

function mappedFieldPaths(input: MerchantProductInput): string[] {
  const attributePaths = Object.keys(input.productAttributes)
    .sort()
    .map((key) => `productAttributes.${key}`);
  return ["offerId", "contentLanguage", "feedLabel", ...attributePaths];
}

function rationaleFor(offer: MappedOffer, context: string | undefined): string {
  const fields = mappedFieldPaths(offer.productInput).join(", ");
  const warnings = [...offer.warnings]
    .map((warning) => `${warning.code}:${warning.path}`)
    .sort()
    .join(", ");
  const parts = [
    `Prepared a Google Merchant ProductInput preview from canonical product and variant fields: ${fields}.`,
  ];
  const normalizedContext = context?.trim();
  if (normalizedContext) parts.push(`Context: ${normalizedContext}.`);
  parts.push(warnings ? `Mapping warnings: ${warnings}.` : "Mapping warnings: none.");
  return parts.join(" ");
}

export function toFeedUpdateProposal(
  offer: MappedOffer,
  meta: PreviewMeta,
): ProposalCreateInput {
  if (
    (offer as { readonly status?: unknown }).status !== "mapped" ||
    !isMerchantProductInput((offer as { readonly productInput?: unknown }).productInput)
  ) {
    throw new TypeError("only a mapped Merchant offer can become a proposal preview");
  }
  if (meta.before !== undefined && !isMerchantProductInput(meta.before)) {
    throw new TypeError("before must be a Merchant payload or omitted");
  }

  return ProposalCreateInputSchema.parse({
    type: "feed_update",
    targetEntity: "google_merchant_product_input",
    targetId: offer.productInputId,
    before: meta.before ?? ABSENT_SNAPSHOT,
    after: offer.productInput,
    rationale: rationaleFor(offer, meta.rationaleContext),
    createdBy: "system",
  });
}
