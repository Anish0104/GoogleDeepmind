// OWNER: Dev 4. Every verdict must map to a distinct, complete style.
import { describe, expect, it } from "vitest";
import type { Verdict } from "@/lib/types";
import { verdictStyle } from "./verdictStyle";

const ALL: Verdict[] = ["Supported", "Contradicted", "Insufficient"];

describe("verdictStyle", () => {
  it("returns a style for every verdict", () => {
    for (const v of ALL) {
      const s = verdictStyle(v);
      expect(s.label).toBe(v);
      expect(s.mark).toBeTruthy();
      expect(s.dot).toContain("bg-");
      expect(s.badge).toContain("text-");
    }
  });

  it("gives each verdict a distinct dot color", () => {
    const dots = new Set(ALL.map((v) => verdictStyle(v).dot));
    expect(dots.size).toBe(ALL.length);
  });
});
