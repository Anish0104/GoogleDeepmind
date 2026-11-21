// OWNER: Dev 1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HAS_FFMPEG } from "@/lib/video/testing";
import { HAS_ZIP, writeFakeRun, type FakeCamera } from "@/lib/capture/sdgFixture";
import { HAS_UNZIP } from "@/lib/capture/sdgMasks";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-sdg-"));
process.env.DATA_DIR = dataDir;

const { chooseViews, importSdgWarehouse, readSdgTruth, sliceMidFrames } = await import("@/lib/capture/sdgWarehouse");
const { probe } = await import("@/lib/video/ffmpeg");

describe("sliceMidFrames", () => {
  it("picks the frame in the middle of each 0.5 s slice at 30 fps", () => {
    expect(sliceMidFrames(60)).toEqual([7, 22, 37, 52]);
  });
});

describe("chooseViews", () => {
  const all = (n: number, a: "yes" | "no") => Array<"yes" | "no">(n).fill(a);
  const cam = (alias: string, worker: ("yes" | "no")[], forklift = all(worker.length, "yes")) => ({ alias, worker, forklift });

  it("puts the camera that loses the worker behind the forklift at the key moment on D", () => {
    const res = chooseViews(
      [
        cam("ceiling_00", all(4, "yes")),
        cam("ceiling_01", ["yes", "no", "yes", "no"]),
        cam("eye_00", all(4, "yes")),
        cam("eye_01", all(4, "no")),
        cam("eye_02", all(4, "no"), all(4, "no")),
      ],
      [1, 2],
    );
    expect(res.views).toEqual({ A: "ceiling_00", B: "eye_00", C: "ceiling_01", D: "eye_01" });
    expect(res.reasons.D).toMatch(/hidden/);
  });

  it("falls back to the fourth-best camera when no view is blocked", () => {
    const res = chooseViews(
      [
        cam("ceiling_00", all(4, "yes")),
        cam("ceiling_01", ["yes", "yes", "yes", "no"]),
        cam("eye_00", all(4, "yes")),
        cam("eye_01", ["no", "no", "no", "yes"], ["no", "no", "no", "yes"]), // out of frame, not blocked
      ],
      [1, 2],
    );
    expect(res.views.D).toBe("eye_01");
    expect(res.reasons.D).not.toMatch(/hidden/);
  });

  it("needs at least four cameras", () => {
    expect(() => chooseViews([cam("ceiling_00", all(4, "yes"))], [0])).toThrow(/4 cameras/);
  });
});

const RUN = "abc_run_1_seed_7";
const runDir = path.join(dataDir, "external", "sdg");
const on = () => true;
const CAMS: FakeCamera[] = [
  { alias: "ceiling_00", worker: on, forklift: on },
  { alias: "ceiling_01", worker: (f) => f < 30, forklift: on },
  { alias: "eye_00", worker: on, forklift: on },
  { alias: "eye_01", worker: () => false, forklift: on }, // worker always behind the forklift
  { alias: "eye_02", worker: () => false, forklift: () => false }, // looking elsewhere
];

beforeAll(() => {
  if (HAS_FFMPEG && HAS_ZIP && HAS_UNZIP) writeFakeRun(runDir, RUN, CAMS, 60);
}, 60_000);
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe.skipIf(!HAS_FFMPEG || !HAS_ZIP || !HAS_UNZIP)("importSdgWarehouse", { timeout: 60_000 }, () => {
  it("makes a 4-camera scene and writes the answer key outside the scene folder", async () => {
    const res = await importSdgWarehouse({ runDir, runId: RUN, sceneId: "sdg_test", height: 90 });

    expect(res.views).toEqual({ A: "ceiling_00", B: "eye_00", C: "ceiling_01", D: "eye_01" });
    for (const c of ["A", "B", "C", "D"] as const) {
      expect(res.files[c]).toBe(path.join(dataDir, "scenes", "sdg_test", `cam-${c}.webm`));
      const p = await probe(res.files[c]);
      expect(p.durationS).toBeGreaterThan(1.8);
      expect(p.height).toBe(90);
    }
    const manifest = JSON.parse(readFileSync(path.join(dataDir, "scenes", "sdg_test", "manifest.json"), "utf8"));
    expect(manifest.room).toBe("sdg-warehouse");
    expect(manifest.cameras).toEqual(["A", "B", "C", "D"]);
    expect(manifest.durationS).toBe(2); // the run's length, not createScene()'s 0

    expect(res.truthPath).toBe(path.resolve(dataDir, "labels", "sdg_test.truth.json"));
    expect(existsSync(path.join(dataDir, "scenes", "sdg_test", "truth.json"))).toBe(false);
    const truth = JSON.parse(readFileSync(res.truthPath, "utf8"));
    expect(readSdgTruth(res.truthPath).sceneId).toBe("sdg_test"); // the schema readers use accepts it
    expect(truth.runId).toBe(RUN);
    expect(truth.presynced).toBe(true);
    expect(truth.summary.outcome).toBe("contact");
    expect(truth.slices).toHaveLength(4);
    const s1 = truth.slices[1];
    expect(s1.t).toBe(0.5);
    expect(s1.answers["forklift:state:moving"]).toBe("yes");
    expect(s1.cameras.A).toMatchObject({ alias: "ceiling_00", "worker:visible:yes": "yes", "forklift:visible:yes": "yes" });
    expect(s1.cameras.D).toMatchObject({ alias: "eye_01", "worker:visible:yes": "no", "forklift:visible:yes": "yes" });
    expect(truth.slices[3].cameras.C["worker:visible:yes"]).toBe("no"); // ceiling_01 loses the worker after frame 30
    expect(truth.allCameras.map((c: { alias: string }) => c.alias)).toHaveLength(5);
  }, 120_000);

  it("honours explicit views and rejects unknown ones", async () => {
    const views = { A: "eye_00", B: "ceiling_00", C: "ceiling_01", D: "eye_02" };
    const res = await importSdgWarehouse({ runDir, runId: RUN, sceneId: "sdg_test2", height: 90, views });
    expect(res.views).toEqual(views);
    await expect(importSdgWarehouse({ runDir, runId: RUN, sceneId: "sdg_test3", views: { ...views, D: "eye_09" } })).rejects.toThrow(/eye_09/);
  }, 120_000);
});
