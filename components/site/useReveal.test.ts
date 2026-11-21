// OWNER: Dev 4.
import { describe, expect, it } from "vitest";
import { revealDelay } from "./useReveal";

describe("revealDelay", () => {
  it("staggers in groups of four, 80 ms apart", () => {
    expect([0, 1, 2, 3, 4].map(revealDelay)).toEqual([0, 0.08, 0.16, 0.24, 0]);
  });
});
