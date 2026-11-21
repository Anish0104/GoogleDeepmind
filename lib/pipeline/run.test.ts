// OWNER: Dev 3. Pipeline runner (probe -> perceive -> stills.json) with every stage faked. No Gemini, no video.
// Labels come from Dev 2's runAccount(); agents run from POST /api/scene/[id]/agents. Neither runs here.
import { describe, expect, it, vi } from "vitest";
import { BudgetExceededError } from "@/lib/cost";
import type { Slice } from "@/lib/capture/slice";
import type { PerceiveOptions, PerceiveResult } from "@/lib/perception/perceive";
import { QUESTION_SETS } from "@/lib/perception/questionSets";
import { isSceneLocked, lockScene } from "@/lib/store/scene";
import type { CameraId, GridRow, RunStatus, SceneManifest } from "@/lib/types";
import { runPipeline, startPipeline, type PipelineDeps } from "@/lib/pipeline/run";

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
const row = (camera: CameraId): GridRow => ({ sceneId: SCENE, camera, t: 10, questionId: "mug:location:C", pYes: 0.9, pVisible: 0.9 });
const slice = (camera: CameraId, t: number): Slice => ({
  camera,
  t,
  durationS: 0.5,
  path: `data/scenes/${SCENE}/slices/cam-${camera}/${t}.mp4`,
  stillPath: `/abs/data/scenes/${SCENE}/stills/cam-${camera}/${String(t * 2).padStart(5, "0")}.jpg`,
});

interface Opts {
  manifest?: Partial<SceneManifest>;
  storedFiles?: SceneManifest["files"];
  missingRecording?: CameraId;
  recordingOutside?: CameraId;
  failAt?: { stage: string; error: Error };
  budgetFails?: boolean;
}

function setup(o: Opts = {}) {
  const calls: string[] = [];
  const writes: { file: string; data: unknown }[] = [];
  const deps = {
    loadManifest: vi.fn(async () => ({ ...structuredClone(manifest), files: o.storedFiles ?? {}, ...o.manifest })),
    scenePath: (id: string, file?: string) => (file ? `/abs/data/scenes/${id}/${file}` : `/abs/data/scenes/${id}`),
    recordingPath: vi.fn((_s: string, camera: CameraId, _files?: SceneManifest["files"]) => {
      if (camera === o.missingRecording) return null;
      if (camera === o.recordingOutside) return `/elsewhere/cam-${camera}.webm`;
      return `/abs/data/scenes/${SCENE}/cam-${camera}.webm`;
    }),
    probe: vi.fn(async (file: string) => {
      calls.push(`probe:${file.match(/cam-(\w)/)![1]}`);
      return { durationS: file.includes("cam-B") ? 28.5 : 30, hasAudio: true };
    }),
    // Dev 1's perceiveScene(): reports each step through onStep.
    perceiveScene: vi.fn(async (_sceneId: string, opts: PerceiveOptions): Promise<PerceiveResult> => {
      calls.push("perceive");
      for (const step of ["sync", "slice", "scout"] as const) {
        if (o.failAt?.stage === `perceive:${step}`) throw o.failAt.error;
        opts.onStep?.(step, `${step} done`);
      }
      if (o.failAt?.stage === "perceive:lattice") throw o.failAt.error;
      opts.onRows?.([row("A"), row("B")]);
      opts.onStep?.("lattice", "2 rows");
      return { presynced: opts.presynced ?? false, sync: [], slices: 16, slicesUsed: 16, entities: 1, questions: 1, rows: 2 };
    }),
    // slices.json as sliceScene() writes it; a D slice leaked in to check stills.json drops it.
    loadSlices: vi.fn(async (): Promise<Slice[]> => {
      calls.push("slices");
      return [...(["A", "B", "C"] as CameraId[]).flatMap((c) => [0, 0.5, 1, 1.5, 2].map((t) => slice(c, t))), slice("D", 1)];
    }),
    writeJson: vi.fn(async (_s: string, file: string, data: unknown) => {
      writes.push({ file, data: structuredClone(data) });
      if (file === "stills.json") calls.push("stills");
    }),
    assertBudget: vi.fn(async () => {
      calls.push("budget");
      if (o.budgetFails) throw new BudgetExceededError({ spentUsd: 8.2, hardStopUsd: 8, blocked: true });
    }),
    now: () => new Date("2026-11-21T16:00:00.000Z"),
  } satisfies PipelineDeps;
  const runs = () => writes.filter((w) => w.file === "run.json").map((w) => w.data as RunStatus);
  return { deps, calls, writes, runs };
}

describe("runPipeline: probe -> perceive -> stills, ending at perceived", () => {
  it("runs probe then perceive (budget checked first) then stills, and ends with status perceived", async () => {
    const { deps, calls, runs } = setup();
    const final = await runPipeline(SCENE, deps);

    expect(final).toEqual({
      status: "perceived",
      stage: "perceived",
      startedAt: "2026-11-21T16:00:00.000Z",
      finishedAt: "2026-11-21T16:00:00.000Z",
    });
    expect(calls).toEqual(["probe:A", "probe:B", "probe:C", "budget", "perceive", "slices", "stills"]);
    expect(runs().map((r) => `${r.status}:${r.stage}`)).toEqual([
      "running:probe",
      "running:perceive",
      "running:stills",
      "perceived:perceived",
    ]);
  });

  it("has no claims, evidence, citation, audit, verdict or agent stage any more", async () => {
    const { deps, writes } = setup();
    await runPipeline(SCENE, deps);
    expect(Object.keys(deps).sort()).toEqual(
      ["assertBudget", "loadManifest", "loadSlices", "now", "perceiveScene", "probe", "recordingPath", "scenePath", "writeJson"].sort(),
    );
    expect(writes.map((w) => w.file)).not.toContain("results.json");
  });

  it("runs without claims.json (the account can come later)", async () => {
    const { deps } = setup();
    expect((await runPipeline(SCENE, deps)).status).toBe("perceived");
  });

  it("probe writes files relative to the scene folder and durationS (shortest recording) before perceive reads the manifest", async () => {
    const { deps, writes } = setup();
    await runPipeline(SCENE, deps);
    const m = writes.find((w) => w.file === "manifest.json")?.data as SceneManifest;
    expect(m.durationS).toBe(28.5);
    expect(m.files).toEqual({ A: "cam-A.webm", B: "cam-B.webm", C: "cam-C.webm" });
    const manifestWrite = writes.findIndex((w) => w.file === "manifest.json");
    const perceiveStage = writes.findIndex((w) => w.file === "run.json" && (w.data as RunStatus).stage === "perceive");
    expect(manifestWrite).toBeLessThan(perceiveStage);
  });

  it("stored relative files are resolved through scenePath when reading", async () => {
    const { deps } = setup({ storedFiles: { A: "cam-A.webm", B: "recordings/b.mp4" } });
    await runPipeline(SCENE, deps);
    expect(deps.recordingPath.mock.calls[0]![2]).toEqual({
      A: `/abs/data/scenes/${SCENE}/cam-A.webm`,
      B: `/abs/data/scenes/${SCENE}/recordings/b.mp4`,
    });
  });

  it("excluded cameras are never probed and never reach stills.json", async () => {
    const { deps, writes } = setup();
    await runPipeline(SCENE, deps);
    expect(deps.recordingPath.mock.calls.map((c) => c[1])).toEqual(["A", "B", "C"]);
    expect(writes.find((w) => w.file === "stills.json")?.data).toEqual({
      A: "stills/cam-A/00002.jpg",
      B: "stills/cam-B/00002.jpg",
      C: "stills/cam-C/00002.jpg",
    });
  });

  it.each([
    ["a missing recording", { missingRecording: "B" as CameraId }, /no recording for camera B/],
    ["a recording outside the scene folder", { recordingOutside: "C" as CameraId }, /camera C.*outside the scene folder/],
  ])("%s fails stage probe with the camera id", async (_n, o, error) => {
    const { deps } = setup(o);
    expect(await runPipeline(SCENE, deps)).toMatchObject({ status: "failed", stage: "probe", error: expect.stringMatching(error) });
    expect(deps.perceiveScene).not.toHaveBeenCalled();
  });

  it.each([
    ["sync", "perceive (sync): sync broke"],
    ["slice", "perceive (slice, after sync): slice broke"],
    ["lattice", "perceive (lattice, after scout): lattice broke"],
  ])("a failure inside perceiveScene at %s is stage perceive, naming Dev 1's step", async (step, error) => {
    const { deps } = setup({ failAt: { stage: `perceive:${step}`, error: new Error(`${step} broke`) } });
    expect(await runPipeline(SCENE, deps)).toMatchObject({ status: "failed", stage: "perceive", error });
  });

  it("a budget stop before perceive is a clean failure with error budget", async () => {
    const { deps, calls } = setup({ budgetFails: true });
    expect(await runPipeline(SCENE, deps)).toMatchObject({ status: "failed", stage: "perceive", error: "budget" });
    expect(calls).not.toContain("perceive");
  });

  it("presynced: true — passes presynced, the manifest's question set and roi to perceiveScene; the probe keeps them", async () => {
    const { deps, writes } = setup({ manifest: { presynced: true, questionSet: "warehouse", roi: true } });
    expect((await runPipeline(SCENE, deps)).status).toBe("perceived");
    const opts = deps.perceiveScene.mock.calls[0]![1];
    expect(opts.presynced).toBe(true);
    expect(opts.questions).toBe(QUESTION_SETS.warehouse);
    expect(opts.roi).toBe(true);
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

  it("passes perceiveScene's maxSlicesPerCamera through, plus its own onStep/onRows", async () => {
    const { deps } = setup();
    await runPipeline(SCENE, { ...deps, perceiveOptions: { maxSlicesPerCamera: 3 } });
    const opts = deps.perceiveScene.mock.calls[0]![1];
    expect(opts.maxSlicesPerCamera).toBe(3);
    expect(typeof opts.onStep).toBe("function");
    expect(typeof opts.onRows).toBe("function");
  });
});

describe("startPipeline (the scene lock from the store)", () => {
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
    expect(startPipeline(SCENE, deps)).toEqual({ started: false, reason: `Scene ${SCENE} already has a run in progress.` });

    await vi.waitFor(() => expect(deps.perceiveScene).toHaveBeenCalled());
    release();
    if (first.started) expect((await first.done).status).toBe("perceived");
    expect(isSceneLocked(SCENE)).toBe(false);
  });

  it("refused while the scene is held by anything else using the store lock (an agent run or the account)", () => {
    const held = lockScene("s-held")!;
    try {
      expect(startPipeline("s-held", setup().deps).started).toBe(false);
    } finally {
      held();
    }
  });

  it("writes queued before running", async () => {
    const { deps, runs } = setup();
    const r = startPipeline("s-queued", deps);
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
