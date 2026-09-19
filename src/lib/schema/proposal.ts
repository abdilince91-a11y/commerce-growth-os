import { z } from "zod";

// Mirrors prisma/schema.prisma's Proposal model — see
// docs/decisions/0002-human-approval-gate.md for the state machine
// this schema participates in.

export const ProposalTypeSchema = z.enum([
  "metadata_change",
  "feed_update",
  "budget_change",
  "bid_change",
]);

export const ProposalCreateInputSchema = z.object({
  type: ProposalTypeSchema,
  targetEntity: z.string().min(1),
  targetId: z.string().min(1),
  before: z.unknown(),
  after: z.unknown(),
  rationale: z.string().min(1, "rationale is required and cannot be empty"),
  createdBy: z.enum(["system", "user"]),
});

export type ProposalCreateInput = z.infer<typeof ProposalCreateInputSchema>;
