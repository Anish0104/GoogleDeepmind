// OWNER: Dev 1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SceneManifest, SyncResult } from "@/lib/types";
import { HAS_FFMPEG } from "@/lib/video/testing";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-slice-"));
process.env.DATA_DIR = dataDir;

const { sliceScene } = await import("@/lib/capture/slice");
const { makeSyncFixture } = await import("@/lib/capture/synthetic");
const { createScene } = await import("@/lib/store/scene");
const { grayFrames } = await import("@/lib/video/ffmpeg");

let manifest: SceneManifest;
// B started recording 1 s before A, so B's flash is 1 s later in its own file.
const sync: SyncResult[] = [
  { camera: "A", offsetS: 0, driftPerMin: 0, method: "both" },
  { camera: "B", offsetS: 1, driftPerMin: 0, method: "both" },
];

beforeAll(async () => {
  if (!HAS_FFMPEG) return;
  manifest = await createScene(
    { split: "starter", room: "r1", cameras: ["A", "B", "C"], excludedCameras: ["C"] },
    { id: "sl1" },
  );
  await makeSyncFixture(path.join(dataDir, "scenes", "sl1"), { A: 2.0, B: 3.0, C: 2.0 }, { durationS: 6 });
}, 120_000);

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const brightness = async (file: string) => {
  const { frames } = await grayFrames(file, 32, 18, 1);
  return Math.max(...frames[0]!);
};

describe.skipIf(!HAS_FFMPEG)("sliceScene", { timeout: 60_000 }, () => {
  it("cuts 0.5 s slices on the common synced range, skipping excluded cameras", async () => {
    const slices = await sliceScene(manifest, sync);
    const a = slices.filter((s) => s.camera === "A");
    const b = slices.filter((s) => s.camera === "B");
    expect(slices.some((s) => s.camera === "C")).toBe(false);
    // A covers synced [0, 6], B covers [-1, 5]: common [0, 5) minus the end margin -> 9 slices each.
    expect(a.map((s) => s.t)).toEqual(Array.from({ length: 9 }, (_, k) => k * 0.5));
    expect(b).toHaveLength(9);
    for (const s of slices) {
      expect(s.durationS).toBe(0.5);
      expect(existsSync(s.path)).toBe(true);
      expect(existsSync(s.stillPath)).toBe(true);
    }
    const index = JSON.parse(readFileSync(path.join(dataDir, "scenes", "sl1", "slices.json"), "utf8"));
    expect(index).toHaveLength(18);
  }, 60_000);

  it("puts the flash (synced 2.0-2.3 s) in the same slice for both cameras", async () => {
    const slices = await sliceScene(manifest, sync);
    for (const cam of ["A", "B"]) {
      const at = (t: number) => slices.find((s) => s.camera === cam && s.t === t)!.stillPath;
      expect(await brightness(at(2))).toBeGreaterThan(200);
      expect(await brightness(at(1.5))).toBeLessThan(120);
    }
  }, 60_000);

  it("with roi, writes roi.json for every sliced camera and still slices them", async () => {
    const slices = await sliceScene(manifest, sync, { roi: true });
    const roi = JSON.parse(readFileSync(path.join(dataDir, "scenes", "sl1", "roi.json"), "utf8"));
    expect(Object.keys(roi).sort()).toEqual(["A", "B"]);
    // the only thing that changes in this fixture is the 80x60 flash patch at (40, 20) of 320x180
    expect(roi.A.x).toBeLessThanOrEqual(40);
    expect(roi.A.x + roi.A.w).toBeGreaterThanOrEqual(120);
    expect(roi.A.y + roi.A.h).toBeGreaterThanOrEqual(80);
    expect(slices.filter((s) => s.camera === "A")).toHaveLength(9);
  }, 60_000);
});
