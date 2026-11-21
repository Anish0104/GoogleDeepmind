// OWNER: Dev 4. Every verdict must map to a distinct, complete style.
import { describe, expect, it } from "vitest";
import type { Verdict } from "@/lib/types";
import { AGENT_COLOR, SOURCE_COLOR, agentColor, verdictStyle } from "./verdictStyle";

const ALL: Verdict[] = ["Supported", "Contradicted", "Insufficient"];

describe("verdictStyle", () => {
  it("returns a complete style for every verdict", () => {
    for (const v of ALL) {
      const s = verdictStyle(v);
      expect(s.label).toBe(v);
      expect(s.mark).toBeTruthy();
      expect(s.color).toMatch(/^#[0-9A-F]{6}$/);
      for (const k of ["bg", "border", "glow"] as const) expect(s[k]).toMatch(/^rgba\(/);
      expect(s.long.length).toBeGreaterThan(10);
    }
  });

  it("gives each verdict a distinct color and glyph", () => {
    expect(new Set(ALL.map((v) => verdictStyle(v).color)).size).toBe(3);
    expect(new Set(ALL.map((v) => verdictStyle(v).mark)).size).toBe(3);
  });

  it("uses the handoff tokens", () => {
    expect(verdictStyle("Supported").color).toBe("#5BE49B");
    expect(verdictStyle("Contradicted").color).toBe("#FF5A47");
    expect(verdictStyle("Insufficient").color).toBe("#FFC23D");
  });
});

describe("agent colors", () => {
  it("colors investigator cyan and skeptic violet", () => {
    expect(agentColor("investigator")).toBe("#7CC7FF");
    expect(agentColor("skeptic")).toBe("#B79CFF");
    expect(AGENT_COLOR.initial).toBe("#ECE6DA");
    expect(SOURCE_COLOR.initial).toBe("#9AA0A8");
  });
});
