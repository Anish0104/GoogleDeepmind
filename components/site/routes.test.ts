// OWNER: Dev 4.
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isSitePath, navIndex } from "./routes";

describe("routing", () => {
  it("wraps only the design routes in the shell", () => {
    for (const p of ["/", "/capture", "/board", "/proof", "/proof/c2", "/results"]) expect(isSitePath(p)).toBe(true);
    for (const p of ["/phone", "/label", "/boardroom", "/api/cost"]) expect(isSitePath(p)).toBe(false);
  });

  it("maps a path to its nav tab", () => {
    expect(NAV_ITEMS).toHaveLength(5);
    expect(navIndex("/")).toBe(0);
    expect(navIndex("/board")).toBe(2);
    expect(navIndex("/proof/c3")).toBe(3);
    expect(navIndex("/results")).toBe(4);
    expect(navIndex("/label")).toBe(-1);
  });
});
