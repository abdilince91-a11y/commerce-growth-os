import { describe, expect, it } from "vitest";
import { assertTransition, InvalidProposalTransitionError } from "./proposals";

describe("assertTransition", () => {
  it("allows pending -> approved", () => {
    expect(() => assertTransition("pending", "approved")).not.toThrow();
  });

  it("allows pending -> rejected", () => {
    expect(() => assertTransition("pending", "rejected")).not.toThrow();
  });

  it("allows approved -> applied", () => {
    expect(() => assertTransition("approved", "applied")).not.toThrow();
  });

  it("blocks pending -> applied directly, per ADR 0002", () => {
    expect(() => assertTransition("pending", "applied")).toThrow(
      InvalidProposalTransitionError,
    );
  });

  it("blocks re-deciding a rejected proposal", () => {
    expect(() => assertTransition("rejected", "approved")).toThrow(
      InvalidProposalTransitionError,
    );
  });

  it("blocks re-applying an already-applied proposal", () => {
    expect(() => assertTransition("applied", "applied")).toThrow(
      InvalidProposalTransitionError,
    );
  });
});
