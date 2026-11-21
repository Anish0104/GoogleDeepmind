// OWNER: Dev 3. Keeps CI green on the empty scaffold; each dev adds tests next to their own code.
import { describe, expect, it } from "vitest";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { SYSTEM_PROMPTS } from "@/lib/agent/prompts";
import { notImplemented } from "@/lib/not-implemented";

describe("scaffold", () => {
  it("orders the verdict thresholds", () => {
    expect(THRESHOLDS.USABLE).toBeLessThan(THRESHOLDS.CLEAR);
    expect(THRESHOLDS.CLEAR).toBeLessThan(THRESHOLDS.DECISIVE);
  });

  it("caps agents at 2 checks and clips at 1-4 s", () => {
    expect(LIMITS.AGENT_MAX_CHECKS).toBe(2);
    expect([LIMITS.CLIP_MIN_S, LIMITS.CLIP_MAX_S]).toEqual([1, 4]);
  });

  it("has a system prompt for both agents", () => {
    expect(SYSTEM_PROMPTS.investigator).toContain("never decide");
    expect(SYSTEM_PROMPTS.skeptic).toContain("never decide");
  });

  it("stubs say who owns them", () => {
    expect(() => notImplemented("Dev 2", "x")).toThrow("[Dev 2]");
  });
});
