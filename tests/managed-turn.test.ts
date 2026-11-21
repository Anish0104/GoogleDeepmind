// OWNER: Dev 3. Managed-agent turn adapter with a fake Interactions client. Response shapes are copied from a
// real run of scripts/probe-agent.ts (signatures trimmed). No real API calls.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiError } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS, MODELS } from "@/lib/config";
import type { AgentMenu, AgentStep, Claim, ClaimResult, CostRecord, Evidence, SceneManifest } from "@/lib/types";
import { INSPECT_WINDOW_DESCRIPTION, SYSTEM_PROMPTS } from "@/lib/agent/prompts";
import { runAgent } from "@/lib/agent/loop";
import { newSession } from "@/lib/agent/environment";
import { createManagedTurn, type InteractionsClient, type ManagedCreateParams } from "@/lib/agent/managed-turn";
import { startAgent } from "@/lib/agent/start";
import type { ModelReply, StandinModel } from "@/lib/agent/standin";

// ---------- probe-shaped responses ----------
const ENV_ID = "85f9a77c1a3b5200c48b751c19bc56cf";
const usage = (input: number, output: number, thought: number, cached = 0) => ({
  total_tokens: input + output + thought,
  total_input_tokens: input,
  input_tokens_by_modality: [{ modality: "text", tokens: input }],
  total_cached_tokens: cached,
  total_output_tokens: output,
  output_tokens_by_modality: [{ modality: "text", tokens: output }],
  total_tool_use_tokens: 0,
  total_thought_tokens: thought,
});
const thought = { type: "thought", summary: [{ type: "text", text: "**Evaluating Camera Perspectives** …" }], signature: "AWkU…" };
const call = (id: string, args: Record<string, unknown>, name = "inspect_window") => ({
  id,
  signature: "AWkUfRO…",
  type: "function_call",
  name,
  arguments: args,
});
const B_10_13 = { camera_id: "B", crop: "full", end_s: 13, reason: "Camera B has an unobstructed side-on view of zone C.", start_s: 10 };
const C_11_13 = { camera_id: "C", crop: "entity", end_s: 13, reason: "Camera C sees the whole mat.", start_s: 11 };

const requiresAction = (id: string, steps: unknown[]) => ({
  id,
  status: "requires_action",
  environment_id: ENV_ID,
  steps: [thought, ...steps],
  usage: usage(5517, 83, 878),
  object: "interaction",
  environment: "remote",
  agent: "antigravity-preview-05-2026",
  agent_config: { max_total_tokens: "60000", type: "antigravity" },
});
const completed = (id: string, text: string) => ({
  id,
  status: "completed",
  previous_interaction_id: "v1_r1",
  environment_id: ENV_ID,
  steps: [
    { call_id: "call_1", type: "function_result", name: "inspect_window", is_error: false, result: {} },
    { type: "model_output", content: [{ type: "text", text }] },
    { signature: "AWkU…", type: "thought" },
  ],
  usage: usage(6546, 99, 96, 3463),
  output_text: text,
  object: "interaction",
  environment: ENV_ID,
});
const PROBE_TEXT =
  "I called `inspect_window` on camera **B** for **10–13 s** because it gives an unobstructed view. Result returned: supports 0.85.";

// ---------- fakes ----------
function fakeClient(creates: unknown[], gets: unknown[] = []) {
  const c = {
    create: vi.fn(async (_p: ManagedCreateParams) => {
      const next = creates.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error("fake client: no more create responses");
      return next;
    }),
    get: vi.fn(async (_id: string, _p: { api_version: string }) => {
      const next = gets.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error("fake client: no more get responses");
      return next;
    }),
  } satisfies InteractionsClient;
  return c;
}

let dir: string;
let log: string;
const loadMenu = async (): Promise<AgentMenu> =>
  JSON.parse(await readFile(path.join(process.cwd(), "fixtures/agent-menu.sample.json"), "utf8")) as AgentMenu;
const readLog = async () =>
  (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as CostRecord);
const ENV_KEYS = ["MANAGED_PRICE_IN", "MANAGED_PRICE_OUT", "AGENT_MODE", "AGENT_FALLBACK"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

beforeEach(async () => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  dir = await mkdtemp(path.join(tmpdir(), "rashomon-managed-"));
  log = path.join(dir, "logs", "costs.jsonl");
});
afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** A fake clock that sleep() advances, so polling and timeouts run instantly. */
function fakeTime() {
  let t = 0;
  return { clock: () => t, sleep: async (ms: number) => void (t += ms) };
}
const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

function turnWith(client: InteractionsClient, extra: Partial<Parameters<typeof createManagedTurn>[0]> = {}) {
  const session = newSession();
  const time = fakeTime();
  const turn = createManagedTurn({ client, session, logPath: log, ...time, ...extra });
  return { turn, session };
}

const stepFor = (menuEv: Partial<Evidence> = {}): AgentStep => ({
  agent: "investigator",
  claimId: "sample-c1",
  n: 1,
  action: "inspect_window",
  args: { camera_id: "B", start_s: 10, end_s: 13, crop: "full", reason: "side view" },
  result: {
    camera: "B",
    window: [10, 13],
    visible: 0.9,
    supports: 0.85,
    contradicts: 0.05,
    clipId: "clip-B-10",
    source: "investigator",
    ...menuEv,
  },
  tokens: 0,
  costUsd: 0,
  latencyMs: 0,
});

// ---------- turn-level behaviour ----------
describe("createManagedTurn", () => {
  it("requires_action with one inspect_window: returns the raw call and saves id and environment_id", async () => {
    quiet();
    const client = fakeClient([requiresAction("v1_r1", [call("call_1", B_10_13)])]);
    const { turn, session } = turnWith(client);
    const menu = await loadMenu();

    const out = await turn({ agent: "investigator", menu, history: [] });

    expect(out).toMatchObject({ name: "inspect_window", args: B_10_13, tokens: 5517 + 83 + 878 });
    expect(out.implicitStop).toBeUndefined();
    expect(session).toMatchObject({ interactionId: "v1_r1", environmentId: ENV_ID, pending: { id: "call_1", name: "inspect_window" } });

    const first = client.create.mock.calls[0]![0];
    expect(first).toMatchObject({
      api_version: "v1beta",
      agent: MODELS.AGENT_ID,
      environment: "remote",
      system_instruction: SYSTEM_PROMPTS.investigator,
      stream: false,
    });
    expect(first.previous_interaction_id).toBeUndefined();
    expect(typeof first.input).toBe("string");
    expect(first.input).toContain('"still-B-12"'); // claim + menu + stills/views go in as the input
    expect(first.input).toContain("I put the red mug on the table in zone C");
  });

  it("the second turn sends previous_interaction_id, the environment id, only our two tools, and no signatures", async () => {
    quiet();
    const client = fakeClient([requiresAction("v1_r1", [call("call_1", B_10_13)]), completed("v1_r2", PROBE_TEXT)]);
    const { turn, session } = turnWith(client);
    const menu = await loadMenu();
    await turn({ agent: "investigator", menu, history: [] });

    await turn({ agent: "investigator", menu: { ...menu, followUpsLeft: 1 }, history: [stepFor()] });

    const second = client.create.mock.calls[1]![0];
    expect(second).toMatchObject({
      previous_interaction_id: "v1_r1",
      environment: ENV_ID,
      agent: MODELS.AGENT_ID,
      system_instruction: SYSTEM_PROMPTS.investigator,
    });
    expect(second.tools.map((t) => t.name)).toEqual(["inspect_window", "stop"]);
    expect(second.tools[0]!.description).toBe(INSPECT_WINDOW_DESCRIPTION);
    expect(second.tools.every((t) => t.type === "function")).toBe(true);
    expect(second.input).toEqual([
      {
        type: "function_result",
        call_id: "call_1",
        name: "inspect_window",
        result: {
          evidence: { camera: "B", window: [10, 13], visible: 0.9, supports: 0.85, contradicts: 0.05 },
          followUpsLeft: 1,
          next: "Call inspect_window for another allowed clip, or call stop.",
        },
      },
    ]);
    expect(JSON.stringify(second)).not.toContain("signature");
    expect(session.interactionId).toBe("v1_r2");
  });

  it("a rejected step goes back as an is_error result with the reason", async () => {
    quiet();
    const client = fakeClient([requiresAction("v1_r1", [call("call_1", B_10_13)]), completed("v1_r2", PROBE_TEXT)]);
    const { turn } = turnWith(client);
    const menu = await loadMenu();
    await turn({ agent: "investigator", menu, history: [] });
    const rejected: AgentStep = { ...stepFor(), action: "rejected", result: undefined, rejectionReason: "Camera D is not available." };

    await turn({ agent: "investigator", menu: { ...menu, followUpsLeft: 1 }, history: [rejected] });

    expect(client.create.mock.calls[1]![0].input).toEqual([
      {
        type: "function_result",
        call_id: "call_1",
        name: "inspect_window",
        is_error: true,
        result: {
          error: "Camera D is not available.",
          claimWindowS: [10, 14],
          validExample: { camera_id: "B", start_s: 10, end_s: 14 }, // the step asked for B
          followUpsLeft: 1,
          next: "Call inspect_window for another allowed clip, or call stop.",
        },
      },
    ]);
  });

  it("completed with no pending call: an implicit stop whose reason is the first sentence of output_text", async () => {
    quiet();
    const client = fakeClient([requiresAction("v1_r1", [call("call_1", B_10_13)]), completed("v1_r2", PROBE_TEXT)]);
    const { turn } = turnWith(client);
    const menu = await loadMenu();
    await turn({ agent: "investigator", menu, history: [] });

    const out = await turn({ agent: "investigator", menu: { ...menu, followUpsLeft: 1 }, history: [stepFor()] });

    expect(out).toMatchObject({
      name: "stop",
      implicitStop: true,
      args: { reason: "I called `inspect_window` on camera **B** for **10–13 s** because it gives an unobstructed view." },
    });
  });

  it("two pending calls: the first is handled, the second goes back as an is_error result", async () => {
    quiet();
    const client = fakeClient([
      requiresAction("v1_r1", [call("call_1", B_10_13), call("call_2", C_11_13)]),
      completed("v1_r2", PROBE_TEXT),
    ]);
    const { turn, session } = turnWith(client);
    const menu = await loadMenu();

    const out = await turn({ agent: "investigator", menu, history: [] });
    expect(out.args).toEqual(B_10_13);
    expect(session.extra).toEqual([{ id: "call_2", name: "inspect_window" }]);

    await turn({ agent: "investigator", menu: { ...menu, followUpsLeft: 1 }, history: [stepFor()] });
    const input = client.create.mock.calls[1]![0].input as { call_id: string; is_error?: boolean }[];
    expect(input.map((r) => [r.call_id, r.is_error ?? false])).toEqual([
      ["call_1", false],
      ["call_2", true],
    ]);
    expect(input[1]).toMatchObject({ result: { error: expect.stringMatching(/one tool call per turn/i) } });
  });

  it("polls in_progress until completed", async () => {
    quiet();
    const inProgress = { ...requiresAction("v1_r1", []), status: "in_progress", steps: [] };
    const client = fakeClient([inProgress], [inProgress, requiresAction("v1_r1", [call("call_1", B_10_13)])]);
    const { turn } = turnWith(client);

    const out = await turn({ agent: "investigator", menu: await loadMenu(), history: [] });

    expect(out.name).toBe("inspect_window");
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(client.get.mock.calls[0]).toEqual(["v1_r1", { api_version: "v1beta" }]);
  });

  it("polling past the timeout is model_unavailable", async () => {
    quiet();
    const inProgress = { ...requiresAction("v1_r1", []), status: "in_progress", steps: [] };
    const client = fakeClient([inProgress], Array.from({ length: 100 }, () => inProgress));
    const { turn } = turnWith(client, { timeoutMs: 5_000 });

    await expect(turn({ agent: "investigator", menu: await loadMenu(), history: [] })).rejects.toThrow(
      /still in_progress after 5000 ms/,
    );
    expect(client.get.mock.calls.length).toBeLessThan(100);
  });

  it.each(["failed", "cancelled", "incomplete"])("%s status is model_unavailable", async (status) => {
    quiet();
    const client = fakeClient([{ ...requiresAction("v1_r1", []), status, steps: [] }]);
    const { turn } = turnWith(client);
    await expect(turn({ agent: "investigator", menu: await loadMenu(), history: [] })).rejects.toThrow(
      new RegExp(`managed agent ${status}`),
    );
  });

  it("an SDK error is retried per MODEL_RETRY_DELAYS_MS, then thrown", async () => {
    quiet();
    const busy = () => new ApiError({ message: "overloaded", status: 503 });
    const client = fakeClient([busy(), busy(), busy(), busy()]);
    const { turn } = turnWith(client);
    await expect(turn({ agent: "investigator", menu: await loadMenu(), history: [] })).rejects.toThrow("overloaded");
    expect(client.create).toHaveBeenCalledTimes(4); // 1 try + 3 retries at the default 1000,2000,4000
  });

  it("a response that doesn't match the expected shape is model_unavailable", async () => {
    quiet();
    const client = fakeClient([{ status: "requires_action" }]); // no id
    const { turn } = turnWith(client);
    await expect(turn({ agent: "investigator", menu: await loadMenu(), history: [] })).rejects.toThrow(/unexpected/i);
  });

  it("never sets background; max_total_tokens is a number", async () => {
    quiet();
    const client = fakeClient([requiresAction("v1_r1", [call("call_1", B_10_13)]), completed("v1_r2", PROBE_TEXT)]);
    const { turn } = turnWith(client);
    const menu = await loadMenu();
    await turn({ agent: "investigator", menu, history: [] });
    await turn({ agent: "investigator", menu: { ...menu, followUpsLeft: 1 }, history: [stepFor()] });

    for (const [params] of client.create.mock.calls) {
      expect(params).not.toHaveProperty("background");
      expect(params.agent_config.type).toBe("antigravity");
      expect(params.agent_config.max_total_tokens).toBe(LIMITS.AGENT_MAX_TOTAL_TOKENS);
      expect(typeof params.agent_config.max_total_tokens).toBe("number");
    }
  });

  it("logs usage with thought tokens counted as output and cached tokens tracked separately", async () => {
    process.env.MANAGED_PRICE_IN = "2";
    process.env.MANAGED_PRICE_OUT = "10";
    const client = fakeClient([requiresAction("v1_r1", [call("call_1", B_10_13)])]);
    const { turn } = turnWith(client, { now: () => new Date("2026-11-21T18:00:00.000Z") });

    const out = await turn({ agent: "skeptic", menu: { ...(await loadMenu()), agent: "skeptic" }, history: [] });

    const usd = (5517 * 2 + (83 + 878) * 10) / 1_000_000;
    expect(out.costUsd).toBeCloseTo(usd, 12);
    expect(await readLog()).toEqual([
      {
        at: "2026-11-21T18:00:00.000Z",
        model: MODELS.AGENT_MODEL ? `${MODELS.AGENT_ID}/${MODELS.AGENT_MODEL}` : MODELS.AGENT_ID,
        purpose: "managed-skeptic",
        inputTokens: 5517,
        outputTokens: 83 + 878,
        cachedTokens: 0,
        usd,
        sceneId: "sample-scene",
      },
    ]);
  });

  it("logs $0 with one warning when MANAGED_PRICE_* are unset", async () => {
    const warn = quiet();
    const client = fakeClient([requiresAction("v1_r1", [call("call_1", B_10_13)]), completed("v1_r2", PROBE_TEXT)]);
    const { turn } = turnWith(client);
    const menu = await loadMenu();
    await turn({ agent: "investigator", menu, history: [] });
    await turn({ agent: "investigator", menu: { ...menu, followUpsLeft: 1 }, history: [stepFor()] });

    expect((await readLog()).map((r) => [r.usd, r.cachedTokens])).toEqual([
      [0, 0],
      [0, 3463],
    ]);
    expect(warn.mock.calls.filter((c) => /MANAGED_PRICE/.test(String(c[0])))).toHaveLength(1);
  });
});

// ---------- through runAgent ----------
const manifest: SceneManifest = {
  sceneId: "sample-scene",
  split: "dev",
  room: "studio",
  cameras: ["A", "B", "C"],
  excludedCameras: [],
  files: {},
  durationS: 30,
  createdAt: "2026-11-21T15:00:00.000Z",
  plannedOcclusion: false,
};

async function loopDeps(menu: AgentMenu) {
  const result: ClaimResult = { claimId: menu.claim.id, verdict: "Insufficient", evidence: [], audit: null, history: [] };
  return {
    start: { result, manifest },
    buildMenu: async () => menu,
    checkWindow: async (a: { camera: Evidence["camera"]; window: [number, number] }): Promise<Evidence> => ({
      camera: a.camera,
      window: a.window,
      visible: 0.9,
      supports: 0.85,
      contradicts: 0.05,
      clipId: `clip-${a.camera}`,
      source: "investigator",
    }),
    audit: async (_c: Claim, e: Evidence) => ({ supportScore: e.supports, contradictScore: e.contradicts, clipId: e.clipId }),
    verdict: () => "Insufficient" as const,
    assertBudget: async () => {},
    logStep: async () => {},
    saveResult: async () => {},
    mode: "managed" as const,
  };
}

describe("managed turn inside runAgent", () => {
  it("followUpsLeft reaching 0 ends the loop without another create call", async () => {
    quiet();
    const client = fakeClient([
      requiresAction("v1_r1", [call("call_1", B_10_13)]),
      requiresAction("v1_r2", [call("call_2", C_11_13)]),
      completed("v1_r3", "never sent"),
    ]);
    const menu = await loadMenu();
    const { turn } = turnWith(client);

    const out = await runAgent("investigator", menu.claim, "sample-scene", { ...(await loopDeps(menu)), turn });

    expect(out.stopReason).toBe("no_follow_ups");
    expect(client.create).toHaveBeenCalledTimes(2); // no third create: the last result is never sent
    expect(out.steps.map((s) => [s.action, s.mode])).toEqual([
      ["inspect_window", "managed"],
      ["inspect_window", "managed"],
      ["stop", "managed"],
    ]);
  });

  it("an implicit stop ends the run as an agent stop marked implicitStop", async () => {
    quiet();
    const client = fakeClient([requiresAction("v1_r1", [call("call_1", B_10_13)]), completed("v1_r2", PROBE_TEXT)]);
    const menu = await loadMenu();
    const { turn } = turnWith(client);
    const out = await runAgent("investigator", menu.claim, "sample-scene", { ...(await loopDeps(menu)), turn });
    expect(out.stopReason).toBe("agent");
    expect(out.steps.at(-1)).toMatchObject({ action: "stop", implicitStop: true, mode: "managed" });
  });

  it("a failed interaction stops the run as model_unavailable", async () => {
    quiet();
    const client = fakeClient([{ ...requiresAction("v1_r1", []), status: "failed", steps: [] }]);
    const menu = await loadMenu();
    const { turn } = turnWith(client);
    const out = await runAgent("investigator", menu.claim, "sample-scene", { ...(await loopDeps(menu)), turn });
    expect(out.stopReason).toBe("model_unavailable");
    expect(out.steps[0]).toMatchObject({ action: "rejected", rejectionReason: expect.stringMatching(/managed agent failed/) });
  });
});

// ---------- mode switch in start.ts ----------
describe("startAgent mode", () => {
  const standinModel = (): StandinModel => ({
    generate: async (): Promise<ModelReply> => ({
      call: { name: "stop", args: { reason: "nothing to add" } },
      text: null,
      inputTokens: 10,
      outputTokens: 2,
      costUsd: 0,
    }),
  });
  async function startDeps(extra: Record<string, unknown>) {
    const menu = await loadMenu();
    const d = await loopDeps(menu);
    return {
      menu,
      deps: {
        loadManifest: async () => manifest,
        loadResults: async () => [d.start.result],
        buildMenu: d.buildMenu,
        checkWindow: d.checkWindow,
        audit: d.audit,
        assertBudget: d.assertBudget,
        logStep: vi.fn(async () => {}),
        saveResult: d.saveResult,
        model: standinModel(),
        ...extra,
      },
    };
  }
  const failing = () => fakeClient([{ ...requiresAction("v1_r1", []), status: "failed", steps: [] }]);

  it("defaults to the stand-in when AGENT_MODE is unset: the managed client is never called", async () => {
    const client = fakeClient([completed("v1_r1", "Nothing in the menu could help.")]);
    const { menu, deps } = await startDeps({ managedOptions: { client, logPath: log } });
    const out = await startAgent("investigator", menu.claim, "sample-scene", deps);
    expect(out).toMatchObject({ ran: true, run: { mode: "standin" } });
    expect(client.create).not.toHaveBeenCalled();
  });

  it("AGENT_MODE=managed runs the managed agent", async () => {
    quiet();
    process.env.AGENT_MODE = "managed";
    const client = fakeClient([completed("v1_r1", "Nothing in the menu could help.")]);
    const { menu, deps } = await startDeps({ managedOptions: { client, logPath: log } });
    const out = await startAgent("investigator", menu.claim, "sample-scene", deps);
    expect(out).toMatchObject({ ran: true, run: { mode: "managed", stopReason: "agent" } });
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it("falls back to the stand-in when managed fails on the first turn and AGENT_FALLBACK=standin", async () => {
    quiet();
    process.env.AGENT_MODE = "managed";
    process.env.AGENT_FALLBACK = "standin";
    const { menu, deps } = await startDeps({ managedOptions: { client: failing(), logPath: log, ...fakeTime() } });

    const out = await startAgent("investigator", menu.claim, "sample-scene", deps);

    expect(out.ran).toBe(true);
    if (!out.ran) return;
    expect(out.run.mode).toBe("standin-fallback");
    expect(out.run.stopReason).toBe("agent");
    expect(out.run.steps.every((s) => s.mode === "standin-fallback")).toBe(true);
    // The failed managed step is still logged, labelled managed: nothing about the switch is hidden.
    const logged = deps.logStep.mock.calls.map((c) => (c as unknown as [string, AgentStep])[1]);
    expect(logged.map((s) => [s.n, s.mode, s.action])).toEqual([
      [1, "managed", "rejected"],
      [2, "standin-fallback", "stop"], // numbering continues from the managed step for this claim
    ]);
    expect(out.run.steps.map((s) => s.n)).toEqual([2]);
  });

  it("without AGENT_FALLBACK a managed failure stays model_unavailable in managed mode", async () => {
    quiet();
    process.env.AGENT_MODE = "managed";
    const { menu, deps } = await startDeps({ managedOptions: { client: failing(), logPath: log, ...fakeTime() } });
    const out = await startAgent("investigator", menu.claim, "sample-scene", deps);
    expect(out).toMatchObject({ ran: true, run: { mode: "managed", stopReason: "model_unavailable" } });
  });

  it("AGENT_MODE=standin runs the stand-in and labels it standin", async () => {
    process.env.AGENT_MODE = "standin";
    const { menu, deps } = await startDeps({});
    const out = await startAgent("investigator", menu.claim, "sample-scene", deps);
    expect(out).toMatchObject({ ran: true, run: { mode: "standin" } });
  });
});
