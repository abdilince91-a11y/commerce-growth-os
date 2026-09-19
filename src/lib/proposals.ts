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

export async function approveProposal(id: string, decidedBy: string): Promise<Proposal> {
  const proposal = await getProposalOrThrow(id);
  assertTransition(proposal.status, "approved");
  return prisma.proposal.update({
    where: { id },
    data: { status: "approved", decidedBy, decidedAt: new Date() },
  });
}

export async function rejectProposal(id: string, decidedBy: string): Promise<Proposal> {
  const proposal = await getProposalOrThrow(id);
  assertTransition(proposal.status, "rejected");
  return prisma.proposal.update({
    where: { id },
    data: { status: "rejected", decidedBy, decidedAt: new Date() },
  });
}

export async function applyProposal(id: string): Promise<Proposal> {
  const proposal = await getProposalOrThrow(id);
  assertTransition(proposal.status, "applied");
  if (!proposal.decidedBy) {
    // Defensive check: assertTransition already guarantees the record
    // passed through "approved", but a missing decidedBy would mean
    // that approval happened without a human — never apply in that case.
    throw new Error(`Proposal ${id} is approved but missing decidedBy`);
  }
  return prisma.proposal.update({
    where: { id },
    data: { status: "applied" },
  });
}
