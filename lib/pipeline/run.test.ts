// OWNER: Dev 3. Pipeline runner with every stage faked. No Gemini calls, no video, no files.
import { describe, expect, it, vi } from "vitest";
import { BudgetExceededError } from "@/lib/cost";
import { AuditUnavailableError } from "@/lib/truth/errors";
import type { Slice } from "@/lib/capture/slice";
import type {
  AgentName,
  Audit,
  CameraId,
  Claim,
  ClaimResult,
  Evidence,
  GridRow,
  Question,
  RunStatus,
  SceneManifest,
  SyncResult,
  Verdict,
} from "@/lib/types";
import { runPipeline, startPipeline, isSceneLocked, type PipelineDeps } from "@/lib/pipeline/run";

const SCENE = "s1";
const manifest: SceneManifest = {
  sceneId: SCENE,
  split: "dev",
  room: "studio",
  cameras: ["A", "B", "C", "D"],
  excludedCameras: ["D"],
  files: {},
  durationS: 0,
  createdAt: "2026-11-21T15:00:00.000Z",
  plannedOcclusion: false,
};
const claim = (id: string): Claim => ({
  id,
  sceneId: SCENE,
  text: `claim ${id}`,
  actor: "Sam",
  object: "red mug",
  action: "put",
  window: [10, 13],
  timeIsPrecise: true,
});
const CLAIMS = [claim("c1"), claim("c2"), claim("c3")];
const QUESTIONS: Question[] = [{ id: "mug:location:C", entityId: "mug", predicate: "location", value: "C", text: "Is the mug in zone C?" }];

const ev = (camera: CameraId, o: Partial<Evidence> = {}): Evidence => ({
  camera,
  window: [10, 13],
  visible: 0.9,
  supports: 0.9,
  contradicts: 0.02,
  clipId: `grid:${SCENE}:${camera}:10-13`,
  source: "initial",
  ...o,
});
const row = (camera: CameraId): GridRow => ({ sceneId: SCENE, camera, t: 10, questionId: "mug:location:C", pYes: 0.9, pVisible: 0.9 });
const slice = (camera: CameraId, t: number): Slice => ({
  camera,
  t,
  durationS: 0.5,
  path: `data/scenes/${SCENE}/slices/cam-${camera}/${t}.mp4`,
  stillPath: `/abs/data/scenes/${SCENE}/stills/cam-${camera}/${String(t * 2).padStart(5, "0")}.jpg`,
});

interface Opts {
  claims?: Claim[];
  missingRecording?: CameraId;
  verdicts?: Record<string, Verdict>;
  agents?: Record<string, AgentName | null>;
  citation?: Record<string, Evidence | null>;
  failAt?: { stage: string; error: Error; claimId?: string };
  budgetFailsBefore?: string;
}

/** Fakes for every stage. `calls` records the order; `writes` records every writeJson. */
function setup(o: Opts = {}) {
  const calls: string[] = [];
  const writes: { file: string; data: unknown }[] = [];
  const fail = (stage: string, claimId?: string) => {
    if (o.failAt && o.failAt.stage === stage && (o.failAt.claimId === undefined || o.failAt.claimId === claimId)) {
      throw o.failAt.error;
    }
  };
  let nextBudgetStage = "";
  const deps = {
    loadManifest: vi.fn(async () => structuredClone(manifest)),
    loadClaims: vi.fn(async () => {
      calls.push("claims");
      return o.claims ?? CLAIMS;
    }),
    recordingPath: vi.fn((_s: string, camera: CameraId) => {
      return camera === o.missingRecording ? null : `/abs/data/scenes/${SCENE}/cam-${camera}.webm`;
    }),
    probe: vi.fn(async (file: string) => {
      calls.push(`probe:${file.match(/cam-(\w)/)![1]}`);
      return { durationS: file.includes("cam-B") ? 28.5 : 30, hasAudio: true };
    }),
    syncScene: vi.fn(async (m: SceneManifest): Promise<SyncResult[]> => {
      calls.push("sync");
      fail("sync");
      return m.cameras.filter((c) => !m.excludedCameras.includes(c)).map((camera) => ({ camera, offsetS: 0, driftPerMin: 0, method: "both" }));
    }),
    sliceScene: vi.fn(async (): Promise<Slice[]> => {
      calls.push("slice");
      fail("slice");
      return (["A", "B", "C"] as CameraId[]).flatMap((c) => [0, 0.5, 1, 1.5, 2].map((t) => slice(c, t)));
    }),
    scout: vi.fn(async (stills: string[]) => {
      calls.push(`scout:${stills.length}`);
      return { entities: [], questions: QUESTIONS };
    }),
    // Pretend a row from excluded camera D leaked into the grid: the runner must drop it.
    latticeScene: vi.fn(async (): Promise<GridRow[]> => {
      calls.push("lattice");
      fail("lattice");
      return [row("A"), row("B"), row("D")];
    }),
    // Pretend evidenceFor() returned D evidence anyway: the runner must drop it too.
    evidenceFor: vi.fn((c: Claim, rows: GridRow[]) => {
      calls.push(`evidence:${c.id}`);
      return [...new Set(rows.map((r) => r.camera)), "D" as CameraId].map((cam) => ev(cam));
    }),
    pickCitation: vi.fn((c: Claim, evidence: Evidence[]) => {
      calls.push(`cite:${c.id}`);
      return o.citation && c.id in o.citation ? o.citation[c.id]! : (evidence[0] ?? null);
    }),
    audit: vi.fn(async (c: Claim, cited: Evidence): Promise<Audit> => {
      calls.push(`audit:${c.id}`);
      fail("audit", c.id);
      return { supportScore: 0.9, contradictScore: 0.02, clipId: cited.clipId };
    }),
    verdict: vi.fn((_e: Evidence[], c: Claim, _a: Audit | null): Verdict => {
      calls.push(`verdict:${c.id}`);
      return o.verdicts?.[c.id] ?? "Insufficient";
    }),
    saveResult: vi.fn(async (_s: string, r: ClaimResult) => {
      calls.push(`save:${r.claimId}`);
    }),
    writeJson: vi.fn(async (_s: string, file: string, data: unknown) => {
      writes.push({ file, data: structuredClone(data) });
      if (file === "stills.json") calls.push("stills");
    }),
    assertBudget: vi.fn(async () => {
      calls.push("budget");
      if (o.budgetFailsBefore && nextBudgetStage === o.budgetFailsBefore) {
        throw new BudgetExceededError({ spentUsd: 8.2, hardStopUsd: 8, blocked: true });
      }
    }),
    eligibleAgent: vi.fn((r: ClaimResult, _c: Claim) => o.agents?.[r.claimId] ?? null),
    startAgent: vi.fn(async (agent: AgentName, c: Claim, _sceneId: string) => {
      calls.push(`agent:${agent}:${c.id}`);
      return { ran: true as const, run: {} as never };
    }),
    onStage: (stage: string) => {
      nextBudgetStage = stage;
    },
    now: () => new Date("2026-11-21T16:00:00.000Z"),
  } satisfies PipelineDeps;
  const runs = () => writes.filter((w) => w.file === "run.json").map((w) => w.data as RunStatus);
  return { deps, calls, writes, runs };
}

describe("runPipeline", () => {
  it("runs the stages in order and calls the budget check before every Gemini stage", async () => {
    const { deps, calls, runs } = setup({ agents: { c1: "investigator", c3: "skeptic" } });

    const final = await runPipeline(SCENE, deps);

    expect(final).toMatchObject({ status: "done", stage: "done" });
    expect(calls).toEqual([
      "claims",
      "probe:A",
      "probe:B",
      "probe:C",
      "sync",
      "slice",
      "budget",
      "scout:6",
      "budget",
      "lattice",
      ...["c1", "c2", "c3"].flatMap((id) => [`evidence:${id}`, `cite:${id}`, "budget", `audit:${id}`, `verdict:${id}`, `save:${id}`]),
      "stills",
      "budget",
      "agent:investigator:c1",
      "agent:skeptic:c3",
    ]);
    expect(runs().map((r) => `${r.status}:${r.stage}`)).toEqual([
      "running:claims",
      "running:probe",
      "running:sync",
      "running:slice",
      "running:scout",
      "running:lattice",
      "running:evidence",
      "running:stills",
      "running:agents",
      "done:done",
    ]);
    expect(runs().at(-1)).toEqual({ status: "done", stage: "done", startedAt: "2026-11-21T16:00:00.000Z", finishedAt: "2026-11-21T16:00:00.000Z" });
  });

  it("excluded cameras never reach evidence, citation, verdict, saved results, scout or stills", async () => {
    const { deps, writes } = setup();
    await runPipeline(SCENE, deps);

    for (const [, rows] of deps.evidenceFor.mock.calls) expect(rows.map((r) => r.camera)).not.toContain("D");
    for (const [, evidence] of deps.pickCitation.mock.calls) expect(evidence.map((e) => e.camera)).not.toContain("D");
    for (const [evidence] of deps.verdict.mock.calls) expect(evidence.map((e) => e.camera)).not.toContain("D");
    for (const [, r] of deps.saveResult.mock.calls) expect(r.evidence.map((e) => e.camera)).not.toContain("D");
    expect(deps.recordingPath.mock.calls.map((c) => c[1])).toEqual(["A", "B", "C"]); // D is never probed
    expect(deps.scout.mock.calls[0]![0].join()).not.toMatch(/cam-D/);
    expect(writes.find((w) => w.file === "stills.json")?.data).not.toHaveProperty("D");
  });

  it("probe writes files and durationS (shortest included recording) into manifest.json", async () => {
    const { deps, writes } = setup();
    await runPipeline(SCENE, deps);

    const m = writes.find((w) => w.file === "manifest.json")?.data as SceneManifest;
    expect(m.durationS).toBe(28.5);
    expect(m.files).toEqual({
      A: `/abs/data/scenes/${SCENE}/cam-A.webm`,
      B: `/abs/data/scenes/${SCENE}/cam-B.webm`,
      C: `/abs/data/scenes/${SCENE}/cam-C.webm`,
    });
    // syncScene sees the updated manifest.
    expect(deps.syncScene.mock.calls[0]![0]).toMatchObject({ durationS: 28.5, files: m.files });
  });

  it("a missing recording for an included camera fails stage probe with the camera id", async () => {
    const { deps, runs } = setup({ missingRecording: "B" });
    const final = await runPipeline(SCENE, deps);
    expect(final).toMatchObject({ status: "failed", stage: "probe", error: expect.stringMatching(/camera B/) });
    expect(runs().at(-1)).toEqual(final);
    expect(deps.syncScene).not.toHaveBeenCalled();
  });

  it("missing or empty claims fail stage claims before anything else runs", async () => {
    const { deps } = setup({ claims: [] });
    const final = await runPipeline(SCENE, deps);
    expect(final).toMatchObject({ status: "failed", stage: "claims", error: "no claims; submit the account first" });
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it("pickCitation null: no audit, verdict with a null audit", async () => {
    const { deps, calls } = setup({ citation: { c2: null } });
    await runPipeline(SCENE, deps);
    expect(calls).not.toContain("audit:c2");
    expect(deps.verdict.mock.calls.find((c) => c[1].id === "c2")?.[2]).toBeNull();
    expect(deps.saveResult.mock.calls.find((c) => c[1].claimId === "c2")?.[1].audit).toBeNull();
  });

  it("AuditUnavailableError falls back to a null audit and the run continues", async () => {
    const { deps } = setup({ failAt: { stage: "audit", claimId: "c2", error: new AuditUnavailableError("checkWindow failed") } });
    const final = await runPipeline(SCENE, deps);
    expect(final.status).toBe("done");
    expect(deps.verdict.mock.calls.find((c) => c[1].id === "c2")?.[2]).toBeNull();
  });

  it("a failed stage sets failed with the stage name and message; earlier results are kept", async () => {
    const { deps, runs } = setup({ failAt: { stage: "audit", claimId: "c2", error: new Error("decide() returned garbage") } });
    const final = await runPipeline(SCENE, deps);

    expect(final).toEqual({
      status: "failed",
      stage: "audit",
      startedAt: "2026-11-21T16:00:00.000Z",
      finishedAt: "2026-11-21T16:00:00.000Z",
      error: "decide() returned garbage",
    });
    expect(runs().at(-1)).toEqual(final);
    expect(deps.saveResult.mock.calls.map((c) => c[1].claimId)).toEqual(["c1"]); // c1 stays saved
    expect(deps.startAgent).not.toHaveBeenCalled();
  });

  it.each([
    ["sync", "sync"],
    ["slice", "slice"],
    ["lattice", "lattice"],
  ])("a failure in %s is reported as stage %s", async (stage, name) => {
    const { deps } = setup({ failAt: { stage, error: new Error(`${stage} broke`) } });
    expect(await runPipeline(SCENE, deps)).toMatchObject({ status: "failed", stage: name, error: `${stage} broke` });
  });

  it("a budget stop is a clean failed status with error budget", async () => {
    const { deps, calls } = setup({ budgetFailsBefore: "lattice" });
    const final = await runPipeline(SCENE, deps);
    expect(final).toMatchObject({ status: "failed", stage: "lattice", error: "budget" });
    expect(calls).not.toContain("lattice");
  });

  it("an eligible claim triggers the right agent; an ineligible one doesn't", async () => {
    const { deps } = setup({ agents: { c1: null, c2: "skeptic", c3: null } });
    await runPipeline(SCENE, deps);
    expect(deps.startAgent.mock.calls.map((c) => [c[0], c[1].id, c[2]])).toEqual([["skeptic", "c2", SCENE]]);
  });

  it("eligibility is judged on the saved result without excluded cameras", async () => {
    const { deps } = setup({ verdicts: { c1: "Supported" } });
    await runPipeline(SCENE, deps);
    const [r, c] = deps.eligibleAgent.mock.calls[0]!;
    expect(c.id).toBe("c1");
    expect(r).toMatchObject({ claimId: "c1", verdict: "Supported", history: [] });
    expect(r.evidence.map((e) => e.camera)).toEqual(["A", "B"]);
  });

  it("writes stills.json: one mid-scene still per included camera, relative to the scene folder", async () => {
    const { deps, writes } = setup();
    await runPipeline(SCENE, deps);
    expect(writes.find((w) => w.file === "stills.json")?.data).toEqual({
      A: "stills/cam-A/00002.jpg",
      B: "stills/cam-B/00002.jpg",
      C: "stills/cam-C/00002.jpg",
    });
  });
});

describe("startPipeline (one run per scene)", () => {
  it("a second run while one is running is refused; the lock is released when it ends", async () => {
    const { deps } = setup();
    let release!: () => void;
    deps.syncScene.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (release = r));
      return [];
    });

    const first = startPipeline(SCENE, deps);
    expect(first.started).toBe(true);
    expect(isSceneLocked(SCENE)).toBe(true);
    const second = startPipeline(SCENE, deps);
    expect(second).toEqual({ started: false, reason: `Scene ${SCENE} already has a run in progress.` });

    await vi.waitFor(() => expect(deps.syncScene).toHaveBeenCalled());
    release();
    if (first.started) await first.done;
    expect(isSceneLocked(SCENE)).toBe(false);
    expect(startPipeline(SCENE, setup().deps).started).toBe(true);
  });

  it("writes queued before running", async () => {
    const { deps, runs } = setup();
    const r = startPipeline("s-queued", { ...deps, loadClaims: async () => [] });
    if (r.started) await r.done;
    expect(runs()[0]).toEqual({ status: "queued", stage: "queued", startedAt: "2026-11-21T16:00:00.000Z" });
  });
});
