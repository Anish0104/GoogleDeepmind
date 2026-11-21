// OWNER: Dev 3. Tests for the stand-in turn with a fake model. No real API calls.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentMenu, AgentStep, Evidence } from "@/lib/types";
import { SYSTEM_PROMPTS } from "@/lib/agent/prompts";
import { parseToolCall, validate } from "@/lib/agent/bridge";
import { runAgent } from "@/lib/agent/loop";
import {
  buildUserMessage,
  NO_TOOL_CALL,
  standinTurn,
  standinTurnFn,
  type ModelReply,
  type ModelRequest,
  type StandinModel,
} from "@/lib/agent/standin";

const loadMenu = async (): Promise<AgentMenu> =>
  JSON.parse(await readFile(path.join(process.cwd(), "fixtures/agent-menu.sample.json"), "utf8")) as AgentMenu;

function fakeModel(replies: Partial<ModelReply>[]): StandinModel & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let i = 0;
  return {
    requests,
    generate: vi.fn(async (req: ModelRequest) => {
      requests.push(req);
      const r = replies[i++] ?? {};
      return { call: null, text: null, inputTokens: 0, outputTokens: 0, costUsd: 0, ...r };
    }),
  };
}

const stepWithEvidence: AgentStep = {
  agent: "investigator",
  claimId: "sample-c1",
  n: 1,
  action: "inspect_window",
  args: { camera_id: "B", start_s: 10, end_s: 12, crop: "full", reason: "side view" },
  result: {
    camera: "B",
    window: [10, 12],
    visible: 0.9,
    supports: 0.4,
    contradicts: 0.1,
    clipId: "clip-B-10",
    source: "investigator",
  },
  droppedFields: ["label"],
  tokens: 1234,
  costUsd: 0.5,
  latencyMs: 900,
};

describe("sample menu fixture", () => {
  it("is a menu the bridge accepts a fresh window from", async () => {
    const menu = await loadMenu();
    expect(validate({ camera_id: "B", start_s: 10, end_s: 13, crop: "full", reason: "x" }, menu)).toEqual({ ok: true });
    expect(validate({ camera_id: "A", start_s: 10, end_s: 12, crop: "full", reason: "x" }, menu).ok).toBe(false);
  });
});

describe("buildUserMessage", () => {
  it("includes the menu as JSON (plus claimWindowS) with stills as IDs only", async () => {
    const menu = await loadMenu();
    const msg = buildUserMessage(menu, []);
    const json = msg.split("\n")[1]!;
    expect(JSON.parse(json)).toEqual({ ...menu, claimWindowS: menu.claim.window });
    expect(msg).toContain('"still-B-12"');
    expect(msg).toMatch(/Your earlier steps: none/);
    expect(msg).toMatch(/exactly one tool/i);
  });

  it("summarises earlier steps without tokens, cost or latency", async () => {
    const msg = buildUserMessage(await loadMenu(), [stepWithEvidence]);
    expect(msg).toContain('"clip-B-10"');
    expect(msg).toContain('"supports":0.4');
    expect(msg).not.toMatch(/tokens|costUsd|latencyMs|droppedFields/);
  });

  it("states the overlap rule and that a clip over the claim window is new evidence", async () => {
    const msg = buildUserMessage(await loadMenu(), []);
    expect(msg).toContain(
      "Your clip must share at least 1 s with claimWindowS. A clip that only touches its start or end is rejected. " +
        "The padding in allowedRangeS is there so a clip can start a little before or end a little after the claim window while still overlapping it.",
    );
    expect(msg).toContain(
      "The first pass looked at stills only. A clip over the claim window itself is new evidence, even on a camera already used.",
    );
  });

  it("a rejected step comes back with the claim window and a valid example on the same camera", async () => {
    const menu = await loadMenu(); // claim window [10, 14], A [10, 12] already checked
    const rejected: AgentStep = {
      ...stepWithEvidence,
      action: "rejected",
      args: { camera_id: "B", start_s: 7, end_s: 10, crop: "full", reason: "just before" },
      result: undefined,
      rejectionReason: "Clip must share at least 1 s with the claim window 10–14 s.",
    };
    const msg = buildUserMessage(menu, [rejected]);
    const steps = JSON.parse(msg.slice(msg.indexOf("Your earlier steps: ") + 20, msg.lastIndexOf("]") + 1)) as unknown[];
    expect(steps[0]).toMatchObject({
      action: "rejected",
      rejectionReason: "Clip must share at least 1 s with the claim window 10–14 s.",
      claimWindowS: [10, 14],
      validExample: { camera_id: "B", start_s: 10, end_s: 14 },
    });
  });

  it("includes rejection reasons so the agent can correct itself", async () => {
    const rejected: AgentStep = {
      ...stepWithEvidence,
      action: "rejected",
      result: undefined,
      rejectionReason: "Window [10, 12] s overlaps",
    };
    expect(buildUserMessage(await loadMenu(), [rejected])).toContain("Window [10, 12] s overlaps");
  });
});

describe("standinTurn", () => {
  it("returns the model's raw tool call with usage and latency", async () => {
    const menu = await loadMenu();
    const model = fakeModel([
      {
        call: { name: "inspect_window", args: { camera_id: "B", start_s: 10, end_s: 13, crop: "full", reason: "r" } },
        inputTokens: 300,
        outputTokens: 20,
        costUsd: 0.0012,
      },
    ]);
    let t = 1000;
    const out = await standinTurn("SYS", menu, [], model, () => (t += 250));

    expect(out).toEqual({
      name: "inspect_window",
      args: { camera_id: "B", start_s: 10, end_s: 13, crop: "full", reason: "r" },
      tokens: 320,
      costUsd: 0.0012,
      latencyMs: 250,
    });
    expect(model.requests).toEqual([
      { systemInstruction: "SYS", userText: buildUserMessage(menu, []), sceneId: "sample-scene" },
    ]);
  });

  it("turns a text reply into a malformed call that the bridge rejects", async () => {
    const model = fakeModel([{ text: "I think the mug was placed.", inputTokens: 10, outputTokens: 5 }]);
    const out = await standinTurn("SYS", await loadMenu(), [], model);
    expect(out.name).toBe(NO_TOOL_CALL);
    expect(out.args).toEqual({ text: "I think the mug was placed." });
    expect(parseToolCall(out.name, out.args)).toMatchObject({ ok: false });
  });

  it("truncates a long text reply", async () => {
    const model = fakeModel([{ text: "x".repeat(5000) }]);
    const out = await standinTurn("SYS", await loadMenu(), [], model);
    expect((out.args as { text: string }).text.length).toBeLessThanOrEqual(500);
  });
});

describe("standinTurnFn", () => {
  it("uses the agent's system prompt", async () => {
    const model = fakeModel([{ call: { name: "stop", args: { reason: "done" } } }]);
    const menu = { ...(await loadMenu()), agent: "skeptic" as const };
    await standinTurnFn(model)({ agent: "skeptic", menu, history: [] });
    expect(model.requests[0]?.systemInstruction).toBe(SYSTEM_PROMPTS.skeptic);
  });

  it("drives runAgent: a text reply uses a check, then a valid call and stop", async () => {
    const menu = await loadMenu();
    const model = fakeModel([
      { text: "Probably supported." },
      { call: { name: "inspect_window", args: { camera_id: "B", start_s: 10, end_s: 13, crop: "full", reason: "side" } } },
      { call: { name: "stop", args: { reason: "done" } } },
    ]);
    const evidence = (a: { camera: "A" | "B" | "C" | "D"; window: [number, number] }): Evidence => ({
      camera: a.camera,
      window: a.window,
      visible: 0.9,
      supports: 0.9,
      contradicts: 0.01,
      clipId: "clip",
      source: "investigator",
    });
    const out = await runAgent("investigator", menu.claim, "sample-scene", {
      turn: standinTurnFn(model),
      start: {
        result: { claimId: menu.claim.id, verdict: "Insufficient", evidence: [], audit: null, history: [] },
        manifest: {
          sceneId: "sample-scene",
          split: "dev",
          room: "studio",
          cameras: ["A", "B", "C"],
          excludedCameras: [],
          files: {},
          durationS: 30,
          createdAt: "2026-11-21T15:00:00.000Z",
          plannedOcclusion: false,
        },
      },
      buildMenu: async () => menu,
      checkWindow: async (a) => evidence(a),
      audit: async (_c, e) => ({ supportScore: e.supports, contradictScore: e.contradicts, clipId: e.clipId }),
      verdict: () => "Insufficient",
      assertBudget: async () => {},
      logStep: async () => {},
      saveResult: async () => {},
    });
    expect(out.steps.map((s) => s.action)).toEqual(["rejected", "inspect_window", "stop"]);
    expect(out.steps[0]?.rejectionReason).toMatch(/no tool call/i);
    expect(out.stopReason).toBe("no_follow_ups"); // the text reply used one of the two checks
  });
});
