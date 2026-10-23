import { prisma } from "@/lib/db";
import type { Proposal, ProposalStatus } from "@prisma/client";

// Enforces the state machine from
// docs/decisions/0002-human-approval-gate.md. Every write to a
// Proposal's status must go through assertTransition so there is no
// code path that reaches "applied" without first passing through
// "approved" with a human decidedBy.

const ALLOWED_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["applied"],
  rejected: [],
  applied: [],
};

export class InvalidProposalTransitionError extends Error {
  constructor(from: ProposalStatus, to: ProposalStatus) {
    super(`Cannot transition proposal from "${from}" to "${to}"`);
    this.name = "InvalidProposalTransitionError";
  }
}

export function assertTransition(from: ProposalStatus, to: ProposalStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidProposalTransitionError(from, to);
  }
}

async function getProposalOrThrow(id: string): Promise<Proposal> {
  const proposal = await prisma.proposal.findUniqueOrThrow({ where: { id } });
  return proposal;
}

// This is input validation, not authentication. Callers must obtain this ID
// from a trusted authenticated server context, never a submitted form field.
function assertDecisionIdentity(decidedBy: string): void {
  if (typeof decidedBy !== "string" || !decidedBy || decidedBy !== decidedBy.trim()
    || decidedBy.length > 256 || /[\x00-\x1f\x7f]/.test(decidedBy)) {
    throw new Error("Invalid decision identity");
  }
}

export async function approveProposal(id: string, decidedBy: string): Promise<Proposal> {
  assertDecisionIdentity(decidedBy);
  const proposal = await getProposalOrThrow(id);
  assertTransition(proposal.status, "approved");
  return prisma.proposal.update({
    where: { id, status: "pending" },
    data: { status: "approved", decidedBy, decidedAt: new Date() },
  });
}

export async function rejectProposal(id: string, decidedBy: string): Promise<Proposal> {
  assertDecisionIdentity(decidedBy);
  const proposal = await getProposalOrThrow(id);
  assertTransition(proposal.status, "rejected");
  return prisma.proposal.update({
    where: { id, status: "pending" },
    data: { status: "rejected", decidedBy, decidedAt: new Date() },
  });
}

export async function applyProposal(id: string): Promise<Proposal> {
  const proposal = await getProposalOrThrow(id);
  assertTransition(proposal.status, "applied");
  if (!proposal.decidedBy || !proposal.decidedAt) {
    // State alone is insufficient: approval metadata must also exist.
    // Identity ownership remains the authenticated caller's responsibility.
    throw new Error("Proposal approval metadata unavailable");
  }
  assertDecisionIdentity(proposal.decidedBy);
  return prisma.proposal.update({
    where: { id, status: "approved", decidedBy: proposal.decidedBy, decidedAt: proposal.decidedAt },
    data: { status: "applied" },
  });
}
