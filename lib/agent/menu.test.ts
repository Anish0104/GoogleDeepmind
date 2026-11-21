// OWNER: Dev 3. Tests for consume(): every call uses a check; only well-formed windows get recorded.
import { describe, expect, it } from "vitest";
import type { AgentMenu, Claim, Evidence, InspectWindowArgs } from "@/lib/types";
import { consume } from "@/lib/agent/menu";

const claim: Claim = {
  id: "c1",
  sceneId: "s1",
  text: "I put the red cup in zone C",
  actor: "speaker",
  object: "red cup",
  action: "place",
  window: [10, 14],
  timeIsPrecise: false,
};

function menu(overrides: Partial<AgentMenu> = {}): AgentMenu {
  return {
    agent: "investigator",
    claim,
    currentVerdict: "Insufficient",
    evidence: [],
    views: [],
    stillIds: {},
    includedCameras: ["A", "B", "C"],
    allowedRangeS: [5, 20],
    alreadyChecked: [],
    followUpsLeft: 2,
    ...overrides,
  };
}

function args(overrides: Partial<InspectWindowArgs> = {}): InspectWindowArgs {
  return { camera_id: "A", start_s: 10, end_s: 12, crop: "full", reason: "side view", ...overrides };
}

const evidence: Evidence = {
  camera: "A",
  window: [10, 12],
  visible: 0.9,
  supports: 0.85,
  contradicts: 0.05,
  clipId: "clip-1",
  source: "investigator",
};

describe("consume", () => {
  it("uses a check, records the window and appends evidence for an accepted call", () => {
    const next = consume(menu(), args(), evidence);
    expect(next.followUpsLeft).toBe(1);
    expect(next.alreadyChecked).toEqual([{ camera: "A", window: [10, 12] }]);
    expect(next.evidence).toEqual([evidence]);
  });

  it("does not mutate the input menu", () => {
    const before = menu();
    const snapshot = structuredClone(before);
    consume(before, args(), evidence);
    expect(before).toEqual(snapshot);
  });

  it("uses a check for a malformed call (args null) and records nothing", () => {
    const next = consume(menu(), null, null);
    expect(next.followUpsLeft).toBe(1);
    expect(next.alreadyChecked).toEqual([]);
    expect(next.evidence).toEqual([]);
  });

  it.each([
    ["excluded camera", { camera_id: "D" as const }],
    ["outside the allowed range", { start_s: 19, end_s: 22 }],
    ["too short", { start_s: 10, end_s: 10.2 }],
    ["too long", { start_s: 10, end_s: 16 }],
    ["reversed", { start_s: 12, end_s: 10 }],
  ])("uses a check but does not record a rejected %s window", (_name, bad) => {
    const next = consume(menu(), args(bad), null);
    expect(next.followUpsLeft).toBe(1);
    expect(next.alreadyChecked).toEqual([]);
  });

  it("does not widen the blocked area when rejected for overlap", () => {
    const m = menu({ alreadyChecked: [{ camera: "A", window: [10, 12] }] });
    const next = consume(m, args({ start_s: 11, end_s: 13 }), null);
    expect(next.followUpsLeft).toBe(1);
    expect(next.alreadyChecked).toEqual([{ camera: "A", window: [10, 12] }]);
  });

  it("a rejected malformed window does not block a real window later", () => {
    const afterBad = consume(menu(), args({ start_s: 10, end_s: 10.2 }), null);
    const afterGood = consume(afterBad, args({ start_s: 10, end_s: 12 }), evidence);
    expect(afterGood.followUpsLeft).toBe(0);
    expect(afterGood.alreadyChecked).toEqual([{ camera: "A", window: [10, 12] }]);
  });

  it("does not record a valid window rejected only because no follow-ups were left", () => {
    const next = consume(menu({ followUpsLeft: 0 }), args(), null);
    expect(next.followUpsLeft).toBe(0);
    expect(next.alreadyChecked).toEqual([]);
  });

  it("never lets followUpsLeft go below 0", () => {
    expect(consume(menu({ followUpsLeft: 0 }), null, null).followUpsLeft).toBe(0);
    expect(consume(menu({ followUpsLeft: -3 }), null, null).followUpsLeft).toBe(0);
  });

  it("copies the window so later changes to args do not leak in", () => {
    const a = args();
    const next = consume(menu(), a, evidence);
    a.start_s = 0;
    expect(next.alreadyChecked[0]?.window).toEqual([10, 12]);
  });
});
