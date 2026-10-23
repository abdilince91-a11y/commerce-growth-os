import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@prisma/client";

const database = vi.hoisted(() => ({ findUniqueOrThrow: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { proposal: database } }));
import { approveProposal, applyProposal, rejectProposal } from "./proposals";

function setup(overrides: Partial<Proposal> = {}) {
  let row: Proposal = {
    id: "proposal-1", type: "feed_update", targetEntity: "product", targetId: "product-1",
    before: {}, after: {}, rationale: "review", status: "pending", createdBy: "system",
    decidedBy: null, decidedAt: null, createdAt: new Date("2026-10-23T00:00:00Z"), ...overrides,
  };
  database.findUniqueOrThrow.mockImplementation(async () => ({ ...row }));
  database.update.mockImplementation(async ({ where, data }: {
    where: { id: string; status?: string; decidedBy?: string | null; decidedAt?: Date | null };
    data: Partial<Proposal>;
  }) => {
    if (where.id !== row.id || (where.status !== undefined && where.status !== row.status)
      || (where.decidedBy !== undefined && where.decidedBy !== row.decidedBy)
      || (where.decidedAt !== undefined && where.decidedAt?.getTime() !== row.decidedAt?.getTime())) {
      throw new Error("Conditional update failed");
    }
    row = { ...row, ...data };
    return { ...row };
  });
  return () => row;
}

beforeEach(() => vi.resetAllMocks());

describe("persisted approval boundary", () => {
  it("allows only one of concurrent approve/reject decisions to persist", async () => {
    const read = setup();
    const results = await Promise.allSettled([
      approveProposal("proposal-1", "human-1"), rejectProposal("proposal-1", "human-2"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(read()).toMatchObject({ status: "approved", decidedBy: "human-1" });
  });

  it("allows only one concurrent application of the same approved proposal", async () => {
    setup({ status: "approved", decidedBy: "human-1", decidedAt: new Date() });
    const results = await Promise.allSettled([applyProposal("proposal-1"), applyProposal("proposal-1")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it.each(["", " ", "\r\n", "human\u0000id", " padded", "x".repeat(257)])(
    "rejects malformed decision identities before database access (%j)", async (identity) => {
      setup();
      await expect(approveProposal("proposal-1", identity)).rejects.toThrow("Invalid decision identity");
      await expect(rejectProposal("proposal-1", identity)).rejects.toThrow("Invalid decision identity");
      expect(database.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(database.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    { decidedBy: null, decidedAt: new Date() },
    { decidedBy: " ", decidedAt: new Date() },
    { decidedBy: "human-1", decidedAt: null },
  ])("refuses incomplete persisted approval metadata (%j)", async (approval) => {
    setup({ status: "approved", ...approval });
    await expect(applyProposal("proposal-1")).rejects.toThrow();
    expect(database.update).not.toHaveBeenCalled();
  });

  it("binds application to the exact approval metadata that was checked", async () => {
    const decidedAt = new Date();
    setup({ status: "approved", decidedBy: "human-1", decidedAt });
    await applyProposal("proposal-1");
    expect(database.update).toHaveBeenCalledWith({
      where: { id: "proposal-1", status: "approved", decidedBy: "human-1", decidedAt },
      data: { status: "applied" },
    });
  });
});
