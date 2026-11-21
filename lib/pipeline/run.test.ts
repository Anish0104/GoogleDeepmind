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
  Verdict,
} from "@/lib/types";
import { runPipeline, startPipeline, isSceneLocked, type PipelineDeps } from "@/lib/pipeline/run";
import type { PerceiveOptions, PerceiveResult } from "@/lib/perception/perceive";
import { QUESTION_SETS } from "@/lib/perception/questionSets";

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
  /** Extra manifest fields as stored on disk (presynced, questionSet, roi). */
  manifest?: Partial<SceneManifest>;
  storedFiles?: SceneManifest["files"];
  recordingOutside?: CameraId;
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
    loadManifest: vi.fn(async () => ({ ...structuredClone(manifest), files: o.storedFiles ?? {}, ...o.manifest })),
    scenePath: (id: string, file?: string) => (file ? `/abs/data/scenes/${id}/${file}` : `/abs/data/scenes/${id}`),
    loadClaims: vi.fn(async () => {
      calls.push("claims");
      return o.claims ?? CLAIMS;
    }),
    recordingPath: vi.fn((_s: string, camera: CameraId, _files?: SceneManifest["files"]) => {
      if (camera === o.missingRecording) return null;
      if (camera === o.recordingOutside) return `/elsewhere/cam-${camera}.webm`;
      return `/abs/data/scenes/${SCENE}/cam-${camera}.webm`;
    }),
    probe: vi.fn(async (file: string) => {
      calls.push(`probe:${file.match(/cam-(\w)/)![1]}`);
      return { durationS: file.includes("cam-B") ? 28.5 : 30, hasAudio: true };
    }),
    // Dev 1's perceiveScene(): reports each step through onStep and the grid through onRows. Pretend a row
    // from excluded camera D leaked into the grid: the runner must drop it.
    perceiveScene: vi.fn(async (_sceneId: string, opts: PerceiveOptions): Promise<PerceiveResult> => {
      calls.push("perceive");
      for (const step of ["sync", "slice", "scout"] as const) {
        if (o.failAt?.stage === `perceive:${step}`) throw o.failAt.error;
        opts.onStep?.(step, `${step} done`);
      }
      if (o.failAt?.stage === "perceive:lattice") throw o.failAt.error;
      opts.onRows?.([row("A"), row("B")]);
      opts.onRows?.([row("D")]);
      opts.onStep?.("lattice", "3 rows");
      return { presynced: opts.presynced ?? false, sync: [], slices: 16, slicesUsed: 16, entities: 1, questions: 1, rows: 3 };
    }),
    loadQuestions: vi.fn(async () => {
      calls.push("questions");
      return QUESTIONS;
    }),
    // slices.json, as sliceScene() writes it; a D slice leaked in here too.
    loadSlices: vi.fn(async (): Promise<Slice[]> => {
      calls.push("slices");
      return [...(["A", "B", "C"] as CameraId[]).flatMap((c) => [0, 0.5, 1, 1.5, 2].map((t) => slice(c, t))), slice("D", 1)];
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
      "budget",
      "perceive",
      "questions",
      "slices",
      ...["c1", "c2", "c3"].flatMap((id) => [`evidence:${id}`, `cite:${id}`, "budget", `audit:${id}`, `verdict:${id}`, `save:${id}`]),
      "stills",
      "budget",
      "agent:investigator:c1",
      "agent:skeptic:c3",
    ]);
    expect(runs().map((r) => `${r.status}:${r.stage}`)).toEqual([
      "running:claims",
      "running:probe",
      "running:perceive",
      "running:evidence",
      "running:stills",
      "running:agents",
      "done:done",
    ]);
    expect(runs().at(-1)).toEqual({ status: "done", stage: "done", startedAt: "2026-11-21T16:00:00.000Z", finishedAt: "2026-11-21T16:00:00.000Z" });
  });

  it("excluded cameras never reach evidence, citation, verdict, saved results or stills", async () => {
    const { deps, writes } = setup();
    await runPipeline(SCENE, deps);

    for (const [, rows] of deps.evidenceFor.mock.calls) expect(rows.map((r) => r.camera)).not.toContain("D");
    for (const [, evidence] of deps.pickCitation.mock.calls) expect(evidence.map((e) => e.camera)).not.toContain("D");
    for (const [evidence] of deps.verdict.mock.calls) expect(evidence.map((e) => e.camera)).not.toContain("D");
    for (const [, r] of deps.saveResult.mock.calls) expect(r.evidence.map((e) => e.camera)).not.toContain("D");
    expect(deps.recordingPath.mock.calls.map((c) => c[1])).toEqual(["A", "B", "C"]); // D is never probed
    expect(writes.find((w) => w.file === "stills.json")?.data).not.toHaveProperty("D");
  });

  it("probe writes files relative to the scene folder and durationS (shortest recording) into manifest.json", async () => {
    const { deps, writes } = setup();
    await runPipeline(SCENE, deps);

    const m = writes.find((w) => w.file === "manifest.json")?.data as SceneManifest;
    expect(m.durationS).toBe(28.5);
    expect(m.files).toEqual({ A: "cam-A.webm", B: "cam-B.webm", C: "cam-C.webm" });
    // perceiveScene() loads manifest.json itself, so it must already be written when perceive runs.
    const manifestWrite = writes.findIndex((w) => w.file === "manifest.json");
    const perceiveStage = writes.findIndex((w) => w.file === "run.json" && (w.data as RunStatus).stage === "perceive");
    expect(manifestWrite).toBeGreaterThanOrEqual(0);
    expect(manifestWrite).toBeLessThan(perceiveStage);
    expect(deps.perceiveScene.mock.calls[0]![0]).toBe(SCENE);
  });

  it("stored relative files are resolved through scenePath when reading", async () => {
    const { deps } = setup({ storedFiles: { A: "cam-A.webm", B: "recordings/b.mp4" } });
    await runPipeline(SCENE, deps);
    expect(deps.recordingPath.mock.calls[0]![2]).toEqual({
      A: `/abs/data/scenes/${SCENE}/cam-A.webm`,
      B: `/abs/data/scenes/${SCENE}/recordings/b.mp4`,
    });
  });

  it("a recording outside the scene folder fails stage probe with the camera id", async () => {
    const { deps } = setup({ recordingOutside: "C" });
    expect(await runPipeline(SCENE, deps)).toMatchObject({
      status: "failed",
      stage: "probe",
      error: expect.stringMatching(/camera C.*outside the scene folder/),
    });
  });

  it("a missing recording for an included camera fails stage probe with the camera id", async () => {
    const { deps, runs } = setup({ missingRecording: "B" });
    const final = await runPipeline(SCENE, deps);
    expect(final).toMatchObject({ status: "failed", stage: "probe", error: expect.stringMatching(/camera B/) });
    expect(runs().at(-1)).toEqual(final);
    expect(deps.perceiveScene).not.toHaveBeenCalled();
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
    ["sync", "perceive (sync): sync broke"],
    ["slice", "perceive (slice, after sync): slice broke"],
    ["lattice", "perceive (lattice, after scout): lattice broke"],
  ])("a failure inside perceiveScene at %s is stage perceive, naming Dev 1's step", async (step, error) => {
    const { deps } = setup({ failAt: { stage: `perceive:${step}`, error: new Error(`${step} broke`) } });
    expect(await runPipeline(SCENE, deps)).toMatchObject({ status: "failed", stage: "perceive", error });
  });

  it("presynced: true — passes presynced, the manifest's question set and roi to perceiveScene, and the run completes", async () => {
    const { deps, writes } = setup({ manifest: { presynced: true, questionSet: "warehouse", roi: true } });
    const final = await runPipeline(SCENE, deps);

    expect(final.status).toBe("done");
    const opts = deps.perceiveScene.mock.calls[0]![1];
    expect(opts.presynced).toBe(true);
    expect(opts.questions).toBe(QUESTION_SETS.warehouse);
    expect(opts.roi).toBe(true);
    // The probe stage rewrites manifest.json before perceive reads it: the flags must survive.
    expect(writes.find((w) => w.file === "manifest.json")?.data).toMatchObject({ presynced: true, questionSet: "warehouse", roi: true });
  });

  it("a scene without those fields passes none of them (perceiveScene keeps its own defaults)", async () => {
    const { deps } = setup();
    await runPipeline(SCENE, deps);
    const opts = deps.perceiveScene.mock.calls[0]![1];
    expect(opts).not.toHaveProperty("presynced");
    expect(opts).not.toHaveProperty("questions");
    expect(opts).not.toHaveProperty("roi");
  });

  it("an unknown question set in a hand-edited manifest fails stage perceive before calling it", async () => {
    const { deps } = setup({ manifest: { questionSet: "kitchen" } });
    expect(await runPipeline(SCENE, deps)).toMatchObject({
      status: "failed",
      stage: "perceive",
      error: expect.stringMatching(/Unknown question set "kitchen".*warehouse/),
    });
    expect(deps.perceiveScene).not.toHaveBeenCalled();
  });

  it("passes perceiveScene's supported options through (maxSlicesPerCamera), plus its own onStep/onRows", async () => {
    const { deps } = setup();
    await runPipeline(SCENE, { ...deps, perceiveOptions: { maxSlicesPerCamera: 3 } });
    const opts = deps.perceiveScene.mock.calls[0]![1];
    expect(opts.maxSlicesPerCamera).toBe(3);
    expect(typeof opts.onStep).toBe("function");
    expect(typeof opts.onRows).toBe("function");
  });

  it("a budget stop is a clean failed status with error budget", async () => {
    const { deps, calls } = setup({ budgetFailsBefore: "perceive" });
    const final = await runPipeline(SCENE, deps);
    expect(final).toMatchObject({ status: "failed", stage: "perceive", error: "budget" });
    expect(calls).not.toContain("perceive");
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
    deps.perceiveScene.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (release = r));
      return { presynced: false, sync: [], slices: 0, slicesUsed: 0, entities: 0, questions: 0, rows: 0 };
    });

    const first = startPipeline(SCENE, deps);
    expect(first.started).toBe(true);
    expect(isSceneLocked(SCENE)).toBe(true);
    const second = startPipeline(SCENE, deps);
    expect(second).toEqual({ started: false, reason: `Scene ${SCENE} already has a run in progress.` });

    await vi.waitFor(() => expect(deps.perceiveScene).toHaveBeenCalled());
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

describe("presynced path: readers of sync.json (real Dev 1 localTime, temp DATA_DIR)", () => {
  it("with no sync.json (presynced writes none), clip times map to local times with zero offsets", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(tmpdir(), "rashomon-presync-"));
    const prev = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;
    vi.resetModules();
    try {
      const store = await import("@/lib/store/scene");
      const { localTime } = await import("@/lib/capture/sync");
      await store.createScene({ split: "dev", room: "r", cameras: ["A", "B"], excludedCameras: [], presynced: true }, { id: "pre" });
      expect(await localTime("pre", "A", 12.5)).toBe(12.5); // what checkWindow() uses to cut clips
      expect(await localTime("pre", "B", 0)).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = prev;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
