// OWNER: Dev 3. Handlers behind POST /api/investigate, /api/skeptic and /api/scene/start. Fakes only.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentName, Claim, ClaimResult, SceneManifest } from "@/lib/types";
import { handleAgentRequest, type AgentRequestDeps } from "@/lib/api/handlers";
import { lockScene } from "@/lib/pipeline/run";
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

  it.each([
    ["bad split", { split: "prod", room: "r", cameras: ["A"], excludedCameras: [] }],
    ["no cameras", { split: "dev", room: "r", cameras: [], excludedCameras: [] }],
    ["excluded camera not in scene", { split: "dev", room: "r", cameras: ["A"], excludedCameras: ["B"] }],
    ["not an object", "hello"],
  ])("400 for %s", async (_n, body) => {
    const { handleSceneStart } = await import("@/lib/api/handlers");
    expect((await handleSceneStart(body)).status).toBe(400);
  });
});
