// OWNER: Dev 3. Text the agent sees about clip windows: claimWindowS in the menu, and rejection feedback with a
// valid example. validate() itself is unchanged; examples are checked against it.
import { describe, expect, it } from "vitest";
import type { AgentMenu, AgentStep, Claim } from "@/lib/types";
import { validate } from "@/lib/agent/bridge";
import { exampleWindow, menuForAgent, rejectionFeedback } from "@/lib/agent/feedback";

const claim: Claim = {
  id: "c1",
  sceneId: "s1",
  text: "Sam put the kettle in zone E",
  actor: "Sam",
  object: "kettle",
  action: "put",
  window: [21, 24],
  timeIsPrecise: true,
};
const menu = (o: Partial<AgentMenu> = {}): AgentMenu => ({
  agent: "skeptic",
  claim,
  currentVerdict: "Contradicted",
  evidence: [],
  views: [],
  stillIds: {},
  includedCameras: ["A", "B", "C"],
  allowedRangeS: [18, 27],
  alreadyChecked: [],
  followUpsLeft: 1,
  ...o,
});
const rejected = (camera_id: "A" | "B" | "C" | "D", start_s: number, end_s: number, reason: string): AgentStep => ({
  agent: "skeptic",
  claimId: "c1",
  n: 1,
  action: "rejected",
  args: { camera_id, start_s, end_s, crop: "full", reason: "look" },
  rejectionReason: reason,
  tokens: 0,
  costUsd: 0,
  latencyMs: 0,
});
const passes = (m: AgentMenu, ex: { camera_id: "A" | "B" | "C" | "D"; start_s: number; end_s: number }) =>
  validate({ ...ex, crop: "full", reason: "x" }, { ...m, followUpsLeft: 1 }).ok;

describe("menuForAgent", () => {
  it("adds claimWindowS right after allowedRangeS and changes nothing else", () => {
    const m = menu();
    const shown = menuForAgent(m);
    expect(shown.claimWindowS).toEqual([21, 24]);
    const keys = Object.keys(shown);
    expect(keys[keys.indexOf("allowedRangeS") + 1]).toBe("claimWindowS");
    const { claimWindowS: _c, ...rest } = shown;
    expect(rest).toEqual(m);
  });
});

describe("exampleWindow", () => {
  it("claim 21–24 s, agent asked 18–21 s on B: the example is B 21–24 s, which passes validate()", () => {
    const m = menu();
    const ex = exampleWindow(m, "B");
    expect(ex).toEqual({ camera_id: "B", start_s: 21, end_s: 24 });
    expect(passes(m, ex!)).toBe(true);
  });

  it("uses another included camera when the same camera has nothing valid left", () => {
    const m = menu({ alreadyChecked: [{ camera: "B", window: [21, 24] }] });
    const ex = exampleWindow(m, "B");
    expect(ex).toEqual({ camera_id: "A", start_s: 21, end_s: 24 });
    expect(passes(m, ex!)).toBe(true);
  });

  it("an excluded or unknown camera falls back to an included one", () => {
    expect(exampleWindow(menu(), "D")?.camera_id).toBe("A");
  });

  it("cuts a long claim window to CLIP_MAX_S and stretches a short one to CLIP_MIN_S", () => {
    const long = menu({ claim: { ...claim, window: [10, 20] }, allowedRangeS: [7, 23] });
    expect(exampleWindow(long, "A")).toEqual({ camera_id: "A", start_s: 10, end_s: 14 });
    const short = menu({ claim: { ...claim, window: [21, 21.5] } });
    const ex = exampleWindow(short, "A")!;
    expect(ex.end_s - ex.start_s).toBeGreaterThanOrEqual(1);
    expect(passes(short, ex)).toBe(true);
  });

  it("null when no included camera has a valid clip left", () => {
    const m = menu({ alreadyChecked: (["A", "B", "C"] as const).map((camera) => ({ camera, window: [21, 24] as [number, number] })) });
    expect(exampleWindow(m, "A")).toBeNull();
  });
});

describe("rejectionFeedback", () => {
  it("states the bridge's reason, the claim window and a valid example on the same camera", () => {
    const m = menu();
    const step = rejected("B", 18, 21, "Clip must overlap the claim window 21–24 s.");
    expect(rejectionFeedback(step, m)).toEqual({
      error: "Clip must overlap the claim window 21–24 s.",
      claimWindowS: [21, 24],
      validExample: { camera_id: "B", start_s: 21, end_s: 24 },
    });
  });

  it("works for a call that didn't parse (no camera): example on the first valid camera", () => {
    const step: AgentStep = { ...rejected("A", 0, 0, "Invalid inspect_window arguments: camera_id: …"), args: { reason: "Unparsed …" } };
    expect(rejectionFeedback(step, menu())).toMatchObject({ claimWindowS: [21, 24], validExample: { camera_id: "A" } });
  });

  it("leaves out validExample when there is none", () => {
    const m = menu({ alreadyChecked: (["A", "B", "C"] as const).map((camera) => ({ camera, window: [21, 24] as [number, number] })) });
    const fb = rejectionFeedback(rejected("A", 18, 21, "r"), m);
    expect(fb).toEqual({ error: "r", claimWindowS: [21, 24] });
  });
});
