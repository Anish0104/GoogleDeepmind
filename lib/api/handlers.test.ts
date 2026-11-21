// OWNER: Dev 3. Handlers behind POST /api/investigate, /api/skeptic and /api/scene/start. Fakes only.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentName, Claim, ClaimResult, SceneManifest } from "@/lib/types";
import {
  handleAgentRequest,
  handleAgentsRun,
  handleRunStart,
  type AgentRequestDeps,
  type AgentsRunDeps,
} from "@/lib/api/handlers";
import type { AgentOutcome } from "@/lib/agent/start";
import { lockScene, NotFoundError } from "@/lib/store/scene";
import { startAgent } from "@/lib/agent/start";

const SCENE = "s1";
const claim: Claim = {
  id: "c1",
  sceneId: SCENE,
  text: "Sam put the mug in zone C",
  actor: "Sam",
  object: "mug",
  action: "put",
  window: [10, 13],
  timeIsPrecise: true,
};
const manifest: SceneManifest = {
  sceneId: SCENE,
  split: "dev",
  room: "studio",
  cameras: ["A", "B", "C"],
  excludedCameras: [],
  files: {},
  durationS: 30,
  createdAt: "2026-11-21T15:00:00.000Z",
  plannedOcclusion: false,
};
const sup = (camera: "A" | "B") => ({
  camera,
  window: [10, 13] as [number, number],
  visible: 0.95,
  supports: 0.95,
  contradicts: 0.01,
  clipId: `clip-${camera}`,
  source: "initial" as const,
});
const strongSupported: ClaimResult = {
  claimId: "c1",
  verdict: "Supported",
  evidence: [sup("A"), sup("B")],
  audit: { supportScore: 0.95, contradictScore: 0.01, clipId: "clip-A" },
  history: [],
};

/** The REAL startAgent (real eligibility) over fake scene data: no store, no model. */
function deps(result: ClaimResult, over: Partial<AgentRequestDeps> = {}): AgentRequestDeps & { start: ReturnType<typeof vi.fn> } {
  const start = vi.fn((agent: AgentName, c: Claim, sceneId: string) =>
    startAgent(agent, c, sceneId, { loadManifest: async () => manifest, loadResults: async () => [result], mode: "standin" }),
  );
  return { loadClaims: async () => [claim], lockScene, startAgent: start, start, ...over };
}

describe("handleAgentRequest", () => {
  it.each(["investigator", "skeptic"] as const)(
    "%s on an ineligible claim: 200 { ran: false, reason } from explainEligibility",
    async (agent) => {
      const d = deps(strongSupported);
      const res = await handleAgentRequest(agent, { sceneId: SCENE, claimId: "c1" }, d);
      expect(res).toEqual({
        status: 200,
        body: { ran: false, reason: expect.stringMatching(/Strong Supported: neither agent runs\./) },
      });
      expect(d.start).toHaveBeenCalledWith(agent, claim, SCENE);
    },
  );

  it("a locked scene returns 409 and never starts the agent", async () => {
    const d = deps(strongSupported);
    const release = lockScene(SCENE)!;
    try {
      const res = await handleAgentRequest("investigator", { sceneId: SCENE, claimId: "c1" }, d);
      expect(res).toEqual({ status: 409, body: { error: `Scene ${SCENE} already has a run in progress.` } });
      expect(d.start).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it("holds the lock while the agent runs and releases it afterwards, even on an error", async () => {
    let lockedDuring = false;
    const d = deps(strongSupported, {
      startAgent: async () => {
        lockedDuring = lockScene(SCENE) === null;
        throw new Error("disk full");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleAgentRequest("skeptic", { sceneId: SCENE, claimId: "c1" }, d);
    expect(lockedDuring).toBe(true);
    expect(res).toEqual({ status: 500, body: { error: "agent run failed" } });
    const again = lockScene(SCENE);
    expect(again).not.toBeNull();
    again!();
  });

  it("a run returns 200 with ran, steps, result, stopReason and mode", async () => {
    const run = { result: strongSupported, steps: [], stopReason: "agent" as const, mode: "standin" as const };
    const d = deps(strongSupported, { startAgent: async () => ({ ran: true, run }) });
    expect(await handleAgentRequest("investigator", { sceneId: SCENE, claimId: "c1" }, d)).toEqual({
      status: 200,
      body: { ran: true, steps: [], result: strongSupported, stopReason: "agent", mode: "standin" },
    });
  });

  it.each([
    ["no body", null],
    ["missing claimId", { sceneId: SCENE }],
    ["unsafe scene id", { sceneId: "../x", claimId: "c1" }],
  ])("400 for %s", async (_n, body) => {
    const res = await handleAgentRequest("investigator", body, deps(strongSupported));
    expect(res.status).toBe(400);
  });

  it("404 for a claim that isn't in claims.json", async () => {
    const res = await handleAgentRequest("investigator", { sceneId: SCENE, claimId: "nope" }, deps(strongSupported));
    expect(res).toEqual({ status: 404, body: { error: `Claim nope not found in scene ${SCENE}.` } });
  });
});

describe("handleSceneStart", () => {
  let dataDir: string;
  const prev = process.env.DATA_DIR;
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-start-"));
    process.env.DATA_DIR = dataDir;
    vi.resetModules();
  });
  afterEach(async () => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("creates the scene (with plannedOcclusion) and returns 201 { sceneId }", async () => {
    const { handleSceneStart } = await import("@/lib/api/handlers");
    const { loadManifest } = await import("@/lib/store/scene");
    const res = await handleSceneStart({ split: "demo", room: "studio", cameras: ["A", "B"], excludedCameras: [], plannedOcclusion: true });
    expect(res.status).toBe(201);
    const { sceneId } = res.body as { sceneId: string };
    expect(await loadManifest(sceneId)).toMatchObject({ sceneId, split: "demo", cameras: ["A", "B"], plannedOcclusion: true });
  });

  it("accepts presynced, questionSet and roi", async () => {
    const { handleSceneStart } = await import("@/lib/api/handlers");
    const { loadManifest } = await import("@/lib/store/scene");
    const res = await handleSceneStart({
      split: "dev",
      room: "assembly101",
      cameras: ["A", "B", "C", "D"],
      excludedCameras: [],
      presynced: true,
      questionSet: "warehouse",
      roi: true,
    });
    expect(res.status).toBe(201);
    const { sceneId } = res.body as { sceneId: string };
    expect(await loadManifest(sceneId)).toMatchObject({ presynced: true, questionSet: "warehouse", roi: true });
  });

  it.each([
    ["unknown question set", { split: "dev", room: "r", cameras: ["A"], excludedCameras: [], questionSet: "kitchen" }],
    ["non-boolean presynced", { split: "dev", room: "r", cameras: ["A"], excludedCameras: [], presynced: "yes" }],
    ["bad split", { split: "prod", room: "r", cameras: ["A"], excludedCameras: [] }],
    ["no cameras", { split: "dev", room: "r", cameras: [], excludedCameras: [] }],
    ["excluded camera not in scene", { split: "dev", room: "r", cameras: ["A"], excludedCameras: ["B"] }],
    ["not an object", "hello"],
  ])("400 for %s", async (_n, body) => {
    const { handleSceneStart } = await import("@/lib/api/handlers");
    expect((await handleSceneStart(body)).status).toBe(400);
  });
});

describe("handleRunStart (POST /api/scene/[id]/run)", () => {
  const ok = { started: true as const, done: Promise.resolve({ status: "perceived" as const, stage: "perceived", startedAt: "t" }) };

  it("starts the run in the background: 202 { sceneId, status: queued }", async () => {
    const startPipeline = vi.fn(() => ok);
    const res = await handleRunStart(SCENE, { loadManifest: async () => manifest, startPipeline });
    expect(res).toEqual({ status: 202, body: { sceneId: SCENE, status: "queued" } });
    expect(startPipeline).toHaveBeenCalledWith(SCENE);
  });

  it("409 while the scene is held", async () => {
    const startPipeline = vi.fn(() => ({ started: false as const, reason: `Scene ${SCENE} already has a run in progress.` }));
    expect(await handleRunStart(SCENE, { loadManifest: async () => manifest, startPipeline })).toEqual({
      status: 409,
      body: { error: `Scene ${SCENE} already has a run in progress.` },
    });
  });

  it("404 for a missing scene and 400 for an unsafe id, without starting anything", async () => {
    const startPipeline = vi.fn(() => ok);
    const missing = await handleRunStart("nope", {
      loadManifest: async () => {
        throw new NotFoundError("Scene nope not found.");
      },
      startPipeline,
    });
    expect(missing.status).toBe(404);
    expect((await handleRunStart("../x", { loadManifest: async () => manifest, startPipeline })).status).toBe(400);
    expect(startPipeline).not.toHaveBeenCalled();
  });
});

describe("handleAgentsRun (POST /api/scene/[id]/agents)", () => {
  const claimN = (id: string): Claim => ({ ...claim, id });
  const insufficient = (id: string): ClaimResult => ({ claimId: id, verdict: "Insufficient", evidence: [], audit: null, history: [] });
  const strong = (id: string): ClaimResult => ({ ...strongSupported, claimId: id });

  function agentsDeps(over: Partial<AgentsRunDeps> = {}) {
    let active = 0;
    let maxActive = 0;
    const startAgent = vi.fn(async (agent: AgentName, c: Claim): Promise<AgentOutcome> => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return {
        ran: true,
        run: { result: { ...insufficient(c.id), verdict: "Supported" }, steps: [], stopReason: "agent", mode: "standin" },
      };
    });
    const deps: AgentsRunDeps = {
      loadManifest: async () => manifest,
      loadClaims: async () => [claimN("c1"), claimN("c2"), claimN("c3"), claimN("c4")],
      loadResults: async () => [insufficient("c1"), strong("c2"), insufficient("c4")], // c3 has no result yet
      lockScene,
      startAgent,
      ...over,
    };
    return { deps, startAgent, maxActive: () => maxActive };
  }

  it("runs only eligible claims, one at a time, and reports { ran, reason?, mode, before, after } per claim", async () => {
    const { deps, startAgent, maxActive } = agentsDeps();
    const res = await handleAgentsRun(SCENE, deps);

    expect(res.status).toBe(200);
    expect(startAgent.mock.calls.map((c) => [c[0], c[1].id])).toEqual([
      ["investigator", "c1"],
      ["investigator", "c4"],
    ]);
    expect(maxActive()).toBe(1); // sequential
    expect(res.body).toEqual({
      sceneId: SCENE,
      claims: [
        { claimId: "c1", agent: "investigator", ran: true, mode: "standin", before: "Insufficient", after: "Supported", stopReason: "agent" },
        { claimId: "c2", ran: false, reason: expect.stringMatching(/Strong Supported: neither agent runs/), mode: null, before: "Supported", after: "Supported" },
        { claimId: "c3", ran: false, reason: "No result for this claim yet: submit the account first.", mode: null, before: null, after: null },
        { claimId: "c4", agent: "investigator", ran: true, mode: "standin", before: "Insufficient", after: "Supported", stopReason: "agent" },
      ],
    });
  });

  it("judges eligibility without excluded cameras", async () => {
    const excl: SceneManifest = { ...manifest, cameras: ["A", "B", "C"], excludedCameras: ["B"] };
    // Counting B this is strong Supported (two cameras); without B it is weak, so the skeptic runs.
    const { deps, startAgent } = agentsDeps({
      loadManifest: async () => excl,
      loadClaims: async () => [claimN("c1")],
      loadResults: async () => [strong("c1")],
    });
    await handleAgentsRun(SCENE, deps);
    expect(startAgent.mock.calls.map((c) => c[0])).toEqual(["skeptic"]);
  });

  it("a refusal from startAgent is reported with its reason", async () => {
    const { deps } = agentsDeps({
      loadClaims: async () => [claimN("c1")],
      loadResults: async () => [insufficient("c1")],
      startAgent: async () => ({ ran: false, reason: "model unavailable: no key" }),
    });
    expect((await handleAgentsRun(SCENE, deps)).body).toEqual({
      sceneId: SCENE,
      claims: [{ claimId: "c1", agent: "investigator", ran: false, reason: "model unavailable: no key", mode: null, before: "Insufficient", after: "Insufficient" }],
    });
  });

  it("409 while the scene is held (pipeline, account or another agent run); nothing runs", async () => {
    const { deps, startAgent } = agentsDeps();
    const held = lockScene(SCENE)!;
    try {
      expect(await handleAgentsRun(SCENE, deps)).toEqual({ status: 409, body: { error: `Scene ${SCENE} already has a run in progress.` } });
      expect(startAgent).not.toHaveBeenCalled();
    } finally {
      held();
    }
  });

  it("holds the lock for the whole run and releases it after, even on an error", async () => {
    let heldDuring = false;
    const { deps } = agentsDeps({
      loadClaims: async () => [claimN("c1")],
      loadResults: async () => [insufficient("c1")],
      startAgent: async () => {
        heldDuring = lockScene(SCENE) === null;
        throw new Error("disk full");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await handleAgentsRun(SCENE, deps)).toEqual({ status: 500, body: { error: "agent runs failed" } });
    expect(heldDuring).toBe(true);
    const again = lockScene(SCENE);
    expect(again).not.toBeNull();
    again!();
  });

  it("404 when there are no claims yet, 400 for an unsafe scene id", async () => {
    const { deps } = agentsDeps({ loadClaims: async () => [] });
    expect(await handleAgentsRun(SCENE, deps)).toEqual({
      status: 404,
      body: { error: `No claims for scene ${SCENE} yet: submit the account first.` },
    });
    expect((await handleAgentsRun("..", agentsDeps().deps)).status).toBe(400);
  });
});
