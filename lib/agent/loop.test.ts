// OWNER: Dev 3. Tests for runAgent() with a scripted fake agent and fake dependencies. No model calls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/lib/config";
import { BudgetExceededError } from "@/lib/cost";
import { enforceDowngradeOnly as realEnforce, verdict as realVerdict } from "@/lib/inference/verdict";
import type { CheckWindowArgs } from "@/lib/perception/checkWindow";
import type {
  AgentMenu,
  AgentName,
  AgentStep,
  Audit,
  Claim,
  ClaimResult,
  Evidence,
  SceneManifest,
  Verdict,
} from "@/lib/types";
import { runAgent, type AgentDeps, type TurnInput, type TurnOutput } from "@/lib/agent/loop";

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

const manifest: SceneManifest = {
  sceneId: "s1",
  split: "dev",
  room: "studio",
  cameras: ["A", "B", "C", "D"],
  excludedCameras: ["D"],
  files: {},
  durationS: 60,
  createdAt: "2026-11-21T15:00:00.000Z",
  plannedOcclusion: false,
};

const initialEvidence: Evidence = {
  camera: "A",
  window: [10, 12],
  visible: 0.9,
  supports: 0.02,
  contradicts: 0.95,
  clipId: "init-A",
  source: "initial",
};

function startResult(v: Verdict, evidence: Evidence[] = []): ClaimResult {
  return { claimId: claim.id, verdict: v, evidence, audit: null, history: [] };
}

function menuFor(agent: AgentName, result: ClaimResult, overrides: Partial<AgentMenu> = {}): AgentMenu {
  return {
    agent,
    claim,
    currentVerdict: result.verdict,
    evidence: result.evidence,
    views: [],
    stillIds: {},
    includedCameras: ["A", "B", "C"],
    allowedRangeS: [5, 20],
    alreadyChecked: result.evidence.map((e) => ({ camera: e.camera, window: e.window })),
    followUpsLeft: 2,
    ...overrides,
  };
}

const inspect = (camera_id: string, start_s: number, end_s: number, extra: Record<string, unknown> = {}) => ({
  name: "inspect_window",
  args: { camera_id, start_s, end_s, crop: "full", reason: `look at ${camera_id}`, ...extra },
});
const stop = (reason = "nothing else could help") => ({ name: "stop", args: { reason } });

/** Fake scores keyed by camera: what checkWindow() "sees" on that camera. */
type Scores = Partial<Record<string, Pick<Evidence, "visible" | "supports" | "contradicts">>>;

/** Fake verdict(): the most recent clip decides (enough to drive label changes in tests). */
function fakeVerdict(evidence: Evidence[]): Verdict {
  const last = evidence.at(-1);
  if (!last || last.visible < 0.6) return "Insufficient";
  if ((last.contradicts ?? 0) >= 0.9) return "Contradicted";
  if ((last.supports ?? 0) >= 0.8) return "Supported";
  return "Insufficient";
}

interface Setup {
  agent?: AgentName;
  start?: ClaimResult;
  menu?: Partial<AgentMenu>;
  script: { name: string; args: unknown }[];
  scores?: Scores;
  budgetFailsOnCall?: number; // 1-based assertBudget() call that throws
  overrides?: Partial<AgentDeps>;
}

function setup(s: Setup) {
  const agent = s.agent ?? "investigator";
  const start = s.start ?? startResult("Insufficient");
  let turnNo = 0;
  let budgetCalls = 0;
  const turnInputs: TurnInput[] = [];
  const deps = {
    start: { result: start, manifest },
    buildMenu: vi.fn(async () => menuFor(agent, start, s.menu)),
    turn: vi.fn(async (input: TurnInput): Promise<TurnOutput> => {
      turnInputs.push(structuredClone(input));
      const call = s.script[turnNo++] ?? stop("script ended");
      return { ...call, tokens: 100 + turnNo, costUsd: 0.001 * turnNo, latencyMs: 10 * turnNo };
    }),
    checkWindow: vi.fn(async (a: CheckWindowArgs): Promise<Evidence> => {
      const sc = s.scores?.[a.camera] ?? { visible: 0.9, supports: 0.9, contradicts: 0.01 };
      return { camera: a.camera, window: a.window, ...sc, clipId: `clip-${a.camera}-${a.window[0]}`, source: a.source };
    }),
    audit: vi.fn(async (_c: Claim, cited: Evidence): Promise<Audit> => ({
      supportScore: cited.supports,
      contradictScore: cited.contradicts,
      clipId: cited.clipId,
    })),
    verdict: vi.fn((e: Evidence[]) => fakeVerdict(e)),
    enforceDowngradeOnly: vi.fn(realEnforce), // Dev 2's real guard, spied on
    assertBudget: vi.fn(async () => {
      budgetCalls++;
      if (budgetCalls === s.budgetFailsOnCall) {
        throw new BudgetExceededError({ spentUsd: 8.01, hardStopUsd: 8, blocked: true });
      }
    }),
    logStep: vi.fn(async (_id: string, _step: AgentStep) => {}),
    saveResult: vi.fn(async (_id: string, _r: ClaimResult) => {}),
    now: () => new Date("2026-11-21T16:00:00.000Z"),
  } satisfies AgentDeps;
  // deps keeps the vi.fn() types for assertions; overrides replace individual deps for one test.
  return { deps, turnInputs, run: () => runAgent(agent, claim, "s1", { ...deps, ...s.overrides }) };
}

describe("runAgent", () => {
  it("valid check, then stop", async () => {
    const { deps, run, turnInputs } = setup({ script: [inspect("B", 10, 12), stop()] });
    const out = await run();

    expect(out.stopReason).toBe("agent");
    expect(out.steps.map((s) => s.action)).toEqual(["inspect_window", "stop"]);
    expect(out.steps.map((s) => s.n)).toEqual([1, 2]);

    expect(deps.checkWindow).toHaveBeenCalledWith({
      sceneId: "s1",
      camera: "B",
      window: [10, 12],
      crop: "full",
      claim,
      source: "investigator",
    });
    expect(deps.audit).toHaveBeenCalledTimes(1);

    const [first, second] = out.steps;
    expect(first).toMatchObject({
      agent: "investigator",
      claimId: "c1",
      result: { camera: "B", clipId: "clip-B-10", source: "investigator" },
      tokens: 101,
      costUsd: 0.001,
      latencyMs: 10,
      droppedFields: [],
    });
    expect(second).toMatchObject({ action: "stop", args: { reason: "nothing else could help" }, tokens: 102 });

    // Investigator result is applied directly; no downgrade guard.
    expect(out.result.verdict).toBe("Supported");
    expect(out.result.evidence).toHaveLength(1);
    expect(out.result.audit).toEqual({ supportScore: 0.9, contradictScore: 0.01, clipId: "clip-B-10" });
    expect(out.result.history).toEqual([
      {
        from: "Insufficient",
        to: "Supported",
        by: "investigator",
        reason: "look at B (clip clip-B-10)",
        at: "2026-11-21T16:00:00.000Z",
      },
    ]);
    expect(deps.enforceDowngradeOnly).not.toHaveBeenCalled();

    // The second turn sees the updated menu: one follow-up used, window checked, new evidence and label.
    expect(turnInputs[1]?.menu).toMatchObject({
      followUpsLeft: 1,
      currentVerdict: "Supported",
      alreadyChecked: [{ camera: "B", window: [10, 12] }],
    });
    expect(turnInputs[1]?.history).toHaveLength(1);

    expect(deps.logStep.mock.calls.map((c) => c[1])).toEqual(out.steps);
    expect(deps.logStep.mock.calls.every((c) => c[0] === "s1")).toBe(true);
    expect(deps.saveResult).toHaveBeenCalledExactlyOnceWith("s1", out.result);
  });

  it("malformed call uses a check", async () => {
    const { deps, run } = setup({
      script: [{ name: "inspect_window", args: { camera_id: "Z", start_s: 10 } }, inspect("A", 10, 12)],
    });
    const out = await run();

    expect(out.steps.map((s) => s.action)).toEqual(["rejected", "inspect_window", "stop"]);
    expect(out.steps[0]?.rejectionReason).toMatch(/Invalid inspect_window arguments.*camera_id/);
    expect(deps.checkWindow).toHaveBeenCalledTimes(1);
    expect(deps.turn).toHaveBeenCalledTimes(2); // the malformed call used one of the two checks
    expect(out.stopReason).toBe("no_follow_ups");
  });

  it("unknown tool is a rejected step that uses a check", async () => {
    const { deps, run } = setup({ script: [{ name: "set_label", args: { label: "Supported" } }, stop()] });
    const out = await run();
    expect(out.steps[0]).toMatchObject({ action: "rejected", rejectionReason: expect.stringMatching(/Unknown tool/) });
    expect(deps.checkWindow).not.toHaveBeenCalled();
    expect(deps.turn.mock.calls[1]?.[0].menu.followUpsLeft).toBe(1);
  });

  it("overlap rejection", async () => {
    const { deps, run } = setup({
      start: startResult("Insufficient", [initialEvidence]), // A [10,12] already checked
      script: [inspect("A", 11, 13), stop()],
    });
    const out = await run();

    expect(out.steps[0]).toMatchObject({
      action: "rejected",
      args: { camera_id: "A", start_s: 11, end_s: 13 },
      rejectionReason: expect.stringMatching(/already checked/),
    });
    expect(out.steps[0]?.result).toBeUndefined();
    expect(deps.checkWindow).not.toHaveBeenCalled();
    expect(deps.turn.mock.calls[1]?.[0].menu.followUpsLeft).toBe(1);
    expect(out.result.verdict).toBe("Insufficient");
    expect(out.result.history).toEqual([]);
  });

  it("records droppedFields on the step", async () => {
    const { run } = setup({ script: [inspect("B", 10, 12, { label: "Supported", verdict: "x" }), stop()] });
    const out = await run();
    expect(out.steps[0]).toMatchObject({ action: "inspect_window", droppedFields: ["label", "verdict"] });
  });

  it("the 2-check cap forces a stop", async () => {
    const { deps, run } = setup({
      menu: { followUpsLeft: 5 }, // more than the cap: the loop still allows only AGENT_MAX_CHECKS
      script: [inspect("A", 5, 7), inspect("B", 5, 7), inspect("C", 5, 7), inspect("A", 15, 17)],
    });
    const out = await run();

    expect(deps.turn).toHaveBeenCalledTimes(LIMITS.AGENT_MAX_CHECKS);
    expect(deps.checkWindow).toHaveBeenCalledTimes(LIMITS.AGENT_MAX_CHECKS);
    expect(out.stopReason).toBe("no_follow_ups");
    expect(out.steps.map((s) => s.action)).toEqual(["inspect_window", "inspect_window", "stop"]);
    expect(out.steps.at(-1)).toMatchObject({
      args: { reason: expect.stringMatching(/forced stop/i) },
      tokens: 0,
      costUsd: 0,
      latencyMs: 0,
    });
  });

  it("budget exceeded mid-run stops cleanly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps, run } = setup({ script: [inspect("B", 10, 12), inspect("C", 10, 12)], budgetFailsOnCall: 2 });
    const out = await run(); // must not throw

    expect(deps.turn).toHaveBeenCalledTimes(1);
    expect(out.stopReason).toBe("budget");
    expect(out.steps.map((s) => s.action)).toEqual(["inspect_window", "stop"]);
    expect(out.steps[1]?.args).toEqual({ reason: expect.stringMatching(/budget/i) });
    expect(deps.logStep).toHaveBeenCalledTimes(2);
    expect(deps.saveResult).toHaveBeenCalledExactlyOnceWith("s1", out.result);
    expect(out.result.verdict).toBe("Supported"); // evidence gathered before the stop is kept
    warn.mockRestore();
  });

  it("budget exceeded before the first turn makes no model call", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps, run } = setup({ script: [inspect("B", 10, 12)], budgetFailsOnCall: 1 });
    const out = await run();
    expect(deps.turn).not.toHaveBeenCalled();
    expect(out.stopReason).toBe("budget");
    expect(out.steps).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("rethrows errors from assertBudget() that are not a budget stop", async () => {
    const { run } = setup({
      script: [stop()],
      overrides: { assertBudget: async () => Promise.reject(new Error("EACCES")) },
    });
    await expect(run()).rejects.toThrow("EACCES");
  });

  it("a failing turn stops cleanly and still saves", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps, run } = setup({
      script: [],
      overrides: { turn: async () => Promise.reject(new Error("429 rate limited")) },
    });
    const out = await run();
    expect(out.stopReason).toBe("error");
    expect(out.steps).toEqual([expect.objectContaining({ action: "stop", args: { reason: expect.stringMatching(/429/) } })]);
    expect(deps.saveResult).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("a failing checkWindow() becomes a rejected step that uses a check", async () => {
    const { deps, run } = setup({
      script: [inspect("B", 10, 12), stop()],
      overrides: { checkWindow: async () => Promise.reject(new Error("ffmpeg exited 1")) },
    });
    const out = await run();
    expect(out.steps[0]).toMatchObject({ action: "rejected", rejectionReason: expect.stringMatching(/ffmpeg/) });
    expect(deps.turn.mock.calls[1]?.[0].menu).toMatchObject({ followUpsLeft: 1, alreadyChecked: [{ camera: "B" }] });
  });

  it("passes only the menu and its own steps to the agent", async () => {
    const { run, turnInputs } = setup({ script: [stop()] });
    await run();
    expect(Object.keys(turnInputs[0] ?? {}).sort()).toEqual(["agent", "history", "menu"]);
  });

  describe("skeptic", () => {
    const NOW = "2026-11-21T16:30:00.000Z"; // enforceDowngradeOnly() stamps entries with new Date()
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(NOW));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("trying to upgrade Insufficient to Supported is blocked and recorded", async () => {
      const { deps, run } = setup({
        agent: "skeptic",
        start: startResult("Insufficient"),
        script: [inspect("B", 10, 12), stop()],
        scores: { B: { visible: 0.95, supports: 0.95, contradicts: 0.01 } },
      });
      const out = await run();

      expect(deps.verdict).toHaveBeenCalledTimes(1);
      expect(deps.enforceDowngradeOnly).toHaveBeenCalledTimes(1);
      expect(deps.enforceDowngradeOnly.mock.calls[0]?.[1]).toBe("Supported");
      expect(out.result.verdict).toBe("Insufficient");
      expect(out.result.evidence).toHaveLength(1); // the clip is still kept as evidence
      expect(deps.saveResult.mock.calls[0]?.[1].verdict).toBe("Insufficient");
    });

    it("a blocked upgrade produces exactly one history entry, written by enforceDowngradeOnly()", async () => {
      const { run } = setup({
        agent: "skeptic",
        start: startResult("Insufficient"),
        script: [inspect("B", 10, 12), stop()],
        scores: { B: { visible: 0.95, supports: 0.95, contradicts: 0.01 } },
      });
      const out = await run();

      expect(out.result.history).toHaveLength(1);
      expect(out.result.history).toEqual([
        {
          from: "Insufficient",
          to: "Supported",
          by: "skeptic",
          blocked: true,
          reason: "look at B (clip clip-B-10)",
          at: NOW, // enforceDowngradeOnly()'s clock, not the loop's now()
        },
      ]);
    });

    it("downgrading Contradicted to Insufficient is allowed, with one history entry", async () => {
      const { deps, run } = setup({
        agent: "skeptic",
        start: startResult("Contradicted", [initialEvidence]),
        script: [inspect("B", 10, 12), stop()],
        scores: { B: { visible: 0.3, supports: null, contradicts: null } },
      });
      const out = await run();

      expect(deps.enforceDowngradeOnly).toHaveBeenCalledTimes(1);
      expect(out.result.verdict).toBe("Insufficient");
      expect(out.result.evidence).toHaveLength(2);
      expect(out.result.history).toEqual([
        { from: "Contradicted", to: "Insufficient", by: "skeptic", reason: "look at B (clip clip-B-10)", at: NOW },
      ]);
    });

    it("trying to turn Supported into Contradicted is blocked", async () => {
      const { run } = setup({
        agent: "skeptic",
        start: startResult("Supported"),
        script: [inspect("B", 10, 12), stop()],
        scores: { B: { visible: 0.95, supports: 0.01, contradicts: 0.95 } },
      });
      const out = await run();
      expect(out.result.verdict).toBe("Supported");
      expect(out.result.history).toEqual([
        expect.objectContaining({ from: "Supported", to: "Contradicted", blocked: true }),
      ]);
    });

    it("keeps earlier history and appends one entry per change across two checks", async () => {
      const earlier = { from: "Insufficient", to: "Contradicted", by: "investigator", reason: "r", at: "t0" } as const;
      const { run } = setup({
        agent: "skeptic",
        start: { ...startResult("Contradicted", [initialEvidence]), history: [earlier] },
        script: [inspect("B", 5, 7), inspect("C", 10, 12)],
        scores: {
          B: { visible: 0.95, supports: 0.95, contradicts: 0.01 }, // tries Supported: blocked
          C: { visible: 0.2, supports: null, contradicts: null }, // Insufficient: allowed
        },
      });
      const out = await run();
      expect(out.result.verdict).toBe("Insufficient");
      expect(out.result.history).toEqual([
        earlier,
        expect.objectContaining({ from: "Contradicted", to: "Supported", blocked: true }),
        expect.objectContaining({ from: "Contradicted", to: "Insufficient" }),
      ]);
      expect(out.result.history[2]?.blocked).toBeUndefined();
    });

    it("throws if enforceDowngradeOnly() ever lets a label go up", async () => {
      const { deps, run } = setup({
        agent: "skeptic",
        start: startResult("Insufficient"),
        script: [inspect("B", 10, 12), stop()],
        overrides: { enforceDowngradeOnly: (prev, next) => ({ ...prev, verdict: next }) },
      });
      await expect(run()).rejects.toThrow(/enforceDowngradeOnly\(\) let the Skeptic change Insufficient to Supported/);
      expect(deps.saveResult).not.toHaveBeenCalled(); // a wrong label is never saved
    });

    it("no history entry when the label does not change", async () => {
      const { deps, run } = setup({
        agent: "skeptic",
        start: startResult("Supported"),
        script: [inspect("B", 10, 12), stop()],
      });
      const out = await run();
      expect(out.result.verdict).toBe("Supported");
      expect(out.result.history).toEqual([]);
      expect(deps.enforceDowngradeOnly).not.toHaveBeenCalled();
    });

    it("with Dev 2's real verdict(): a second view that supports downgrades a wrong Contradicted", async () => {
      const { run } = setup({
        agent: "skeptic",
        start: startResult("Contradicted", [initialEvidence]), // A contradicts at 0.95
        script: [inspect("B", 10, 12), stop()],
        scores: { B: { visible: 0.95, supports: 0.95, contradicts: 0.01 } },
        overrides: { verdict: realVerdict },
      });
      const out = await run();
      expect(out.result.verdict).toBe("Insufficient"); // two usable cameras disagree
      expect(out.result.history).toEqual([
        expect.objectContaining({ from: "Contradicted", to: "Insufficient", by: "skeptic" }),
      ]);
    });
  });

  describe("investigator history", () => {
    it("the loop writes exactly one LabelChange per change, with its own clock", async () => {
      const { deps, run } = setup({ script: [inspect("B", 10, 12), stop()] });
      const out = await run();
      expect(out.result.history).toEqual([
        expect.objectContaining({ from: "Insufficient", to: "Supported", by: "investigator", at: "2026-11-21T16:00:00.000Z" }),
      ]);
      expect(out.result.history[0]?.blocked).toBeUndefined();
      expect(deps.enforceDowngradeOnly).not.toHaveBeenCalled();
    });
  });
});
