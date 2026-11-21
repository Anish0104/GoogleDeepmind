// OWNER: Dev 4. The replay schedule must place the demo's labels and agent steps on one clock.
import { describe, expect, it } from "vitest";
import { loadScene } from "@/components/loadScene";
import type { AgentStep } from "@/lib/types";
import {
  AGENT_PHASE_S,
  buildTimeline,
  inspectAt,
  isInspectArgs,
  noteAt,
  spentAt,
  stepLine,
  stepReason,
  stepsShown,
  verdictAt,
} from "./timeline";

async function demo() {
  const s = await loadScene("fixtures/replay/demo-001");
  return { s, tl: buildTimeline(s.claims, s.results, s.agentSteps, s.manifest.durationS) };
}

describe("buildTimeline (demo-001)", () => {
  it("runs a 22 s footage pass then the agent phase", async () => {
    const { tl } = await demo();
    expect(tl.foot).toBe(22);
    expect(tl.end).toBe(22 + AGENT_PHASE_S);
  });

  it("spreads agent steps over the agent phase in file order", async () => {
    const { s, tl } = await demo();
    expect(tl.steps).toHaveLength(s.agentSteps.length);
    const ats = tl.steps.map((x) => x.at);
    expect(ats[0]).toBe(23);
    expect(ats[ats.length - 1]).toBe(tl.end - 2);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
  });

  it("lands each first label just after the claim window closes", async () => {
    const { tl } = await demo();
    expect(verdictAt(tl, "c1", 7.4)).toBeNull();
    expect(verdictAt(tl, "c1", 7.5)).toBe("Supported");
    expect(verdictAt(tl, "c2", 13.5)).toBe("Contradicted");
    expect(verdictAt(tl, "c4", 19.5)).toBe("Insufficient");
    // c3 spans the whole scene, so it lands right after the footage pass
    expect(verdictAt(tl, "c3", 22)).toBeNull();
    expect(verdictAt(tl, "c3", 22.2)).toBe("Supported");
  });

  it("applies the Skeptic downgrade on its last step and never applies a blocked change", async () => {
    const { tl } = await demo();
    const c3Last = tl.steps.filter((x) => x.step.claimId === "c3").at(-1)!;
    expect(verdictAt(tl, "c3", c3Last.at - 0.01)).toBe("Supported");
    expect(verdictAt(tl, "c3", c3Last.at)).toBe("Insufficient");
    expect(verdictAt(tl, "c2", tl.end)).toBe("Contradicted");
  });

  it("ends on the final label from results.json for every claim", async () => {
    const { s, tl } = await demo();
    for (const r of s.results) expect(verdictAt(tl, r.claimId, tl.end)).toBe(r.verdict);
  });

  it("marks the step that ended the blocked attempt and notes each claim the agents touched", async () => {
    const { tl } = await demo();
    const blocked = tl.steps.filter((x) => x.blocked);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.step.claimId).toBe("c2");
    expect(noteAt(tl, "c2", tl.end)?.text).toBe("skeptic blocked");
    expect(noteAt(tl, "c3", tl.end)?.text).toBe("downgraded by skeptic");
    expect(noteAt(tl, "c4", tl.end)?.text).toBe("investigator checked");
    expect(noteAt(tl, "c4", 22)).toBeNull();
    expect(noteAt(tl, "c1", tl.end)).toBeNull();
  });

  it("reports the inspecting step and running spend", async () => {
    const { s, tl } = await demo();
    expect(inspectAt(tl, 10)).toBeNull();
    const first = inspectAt(tl, tl.steps[0]!.at);
    expect(first?.camera).toBe("A");
    expect(first?.window).toEqual([9, 13]);
    expect(inspectAt(tl, tl.steps[1]!.at)).toBeNull(); // a stop
    expect(spentAt(tl, 0)).toBe(0);
    expect(spentAt(tl, tl.end)).toBeCloseTo(s.spentUsd, 5);
    expect(stepsShown(tl, tl.steps[2]!.at)).toHaveLength(3);
  });

  it("handles a scene without a duration or agent steps", () => {
    const tl = buildTimeline(
      [{ id: "x", sceneId: "s", text: "t", actor: "a", object: "o", action: "move", window: [0, 4], timeIsPrecise: true }],
      [{ claimId: "x", verdict: "Supported", evidence: [], audit: null, history: [] }],
      [],
      0,
    );
    expect(tl.foot).toBe(4);
    expect(verdictAt(tl, "x", tl.end)).toBe("Supported");
    expect(tl.steps).toEqual([]);
  });
});

describe("step text", () => {
  const base = { agent: "investigator", claimId: "c4", n: 1, tokens: 1, costUsd: 0, latencyMs: 1 } as const;
  const args = { camera_id: "C", start_s: 15, end_s: 19, crop: "full", reason: "look" } as const;

  it("describes inspect, rejected and stop steps", () => {
    const inspect: AgentStep = { ...base, action: "inspect_window", args };
    const rejected: AgentStep = { ...base, action: "rejected", args, rejectionReason: "overlaps" };
    const stop: AgentStep = { ...base, action: "stop", args: { reason: "done" } };
    expect(stepLine(inspect)).toBe("inspect CAM C 15–19s (full)");
    expect(stepLine(rejected)).toBe("rejected CAM C 15–19s");
    expect(stepLine(stop)).toBe("stop");
    expect(stepReason(rejected)).toBe("overlaps");
    expect(stepReason({ ...rejected, rejectionReason: undefined })).toBe("look");
    expect(stepReason(stop)).toBe("done");
    expect(isInspectArgs(args)).toBe(true);
    expect(isInspectArgs({ reason: "x" })).toBe(false);
  });
});
