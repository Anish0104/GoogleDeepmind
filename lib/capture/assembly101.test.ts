// OWNER: Dev 1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { HAS_FFMPEG } from "@/lib/video/testing";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-a101-"));
process.env.DATA_DIR = dataDir;

const { importAssembly101, parseCoarse, parseFine, toSceneSeconds } = await import("@/lib/capture/assembly101");
const { probe } = await import("@/lib/video/ffmpeg");

const REC = "nusar-2021_action_both_9011-b06b_9011_user_id_2021-02-01_154253";
const COARSE = "000000030\t000000090\tattach interior\n000000090\t000000240\tattach wheel\n000000240\t000000300\tattach hook\n";
const FINE =
  "id,video,start_frame,end_frame,action_id,verb_id,noun_id,action_cls,verb_cls,noun_cls,toy_id,toy_name,is_shared,is_RGB\n" +
  `0000001,${REC}/C10115_rgb.mp4,000000015,000000045,0010,0018,0027,clap hand,clap,hand,b06b,-,0,1\n` +
  `0000002,${REC}/C10115_rgb.mp4,000000060,000000120,0019,0000,0005,screw wheel,screw,wheel,b06b,-,0,1\n` +
  `0000003,${REC}/C10118_rgb.mp4,000000060,000000120,0019,0000,0005,screw wheel,screw,wheel,b06b,-,0,1\n`;

describe("label parsing (frames at 30 fps)", () => {
  it("parses coarse rows", () => {
    expect(parseCoarse(COARSE)).toEqual([
      { startFrame: 30, endFrame: 90, action: "attach interior" },
      { startFrame: 90, endFrame: 240, action: "attach wheel" },
      { startFrame: 240, endFrame: 300, action: "attach hook" },
    ]);
  });

  it("parses fine-grained rows for one camera's video only", () => {
    const rows = parseFine(FINE, `${REC}/C10115_rgb.mp4`);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ startFrame: 60, endFrame: 120, action: "screw wheel", verb: "screw", noun: "wheel" });
  });

  it("converts to scene seconds for a trimmed stretch: t = frame / 30 - start, clipped", () => {
    const rows = toSceneSeconds(parseCoarse(COARSE), 2, 6);
    expect(rows).toEqual([
      { startS: 0, endS: 1, action: "attach interior", clipped: true },
      { startS: 1, endS: 4, action: "attach wheel", clipped: true },
    ]);
  });
});

let srcDir: string;
beforeAll(() => {
  if (!HAS_FFMPEG) return;
  srcDir = path.join(dataDir, "external", "recordings", REC);
  mkdirSync(srcDir, { recursive: true });
  for (const v of ["C10115", "C10118", "C10395", "C10119"]) {
    const r = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=480x270:rate=60:duration=8",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(srcDir, `${v}_rgb.mp4`),
    ]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
  }
  const ann = path.join(dataDir, "external", "annotations");
  mkdirSync(path.join(ann, "coarse-annotations", "coarse_labels"), { recursive: true });
  mkdirSync(path.join(ann, "fine-grained-annotations"), { recursive: true });
  writeFileSync(path.join(ann, "coarse-annotations", "coarse_labels", `assembly_${REC}.txt`), COARSE);
  writeFileSync(path.join(ann, "fine-grained-annotations", "train.csv"), FINE);
}, 60_000);

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe.skipIf(!HAS_FFMPEG)("importAssembly101", () => {
  it("makes a 4-camera scene of the trimmed stretch and exports its labels outside the scene", async () => {
    const res = await importAssembly101({
      recordingsDir: path.join(dataDir, "external", "recordings"),
      annotationsDir: path.join(dataDir, "external", "annotations"),
      recording: REC,
      views: { A: "C10115", B: "C10118", C: "C10395", D: "C10119" },
      startS: 2,
      endS: 6,
      sceneId: "a101_test",
      height: 360,
    });
    const scene = path.join(dataDir, "scenes", "a101_test");
    expect(JSON.parse(readFileSync(path.join(scene, "manifest.json"), "utf8")).cameras).toEqual(["A", "B", "C", "D"]);
    for (const c of "ABCD") {
      const p = await probe(path.join(scene, `cam-${c}.webm`));
      expect(p.durationS).toBeGreaterThan(3.8);
      expect(p.durationS).toBeLessThan(4.2);
      expect(p.height).toBe(360);
    }
    expect(existsSync(path.join(scene, "labels.json"))).toBe(false);
    const labels = JSON.parse(readFileSync(res.labelsPath, "utf8"));
    expect(res.labelsPath).toBe(path.join(dataDir, "labels", "a101_test.labels.json"));
    expect(labels.trim).toEqual({ startS: 2, endS: 6 });
    expect(labels.coarse.map((r: { action: string }) => r.action)).toEqual(["attach interior", "attach wheel"]);
    expect(labels.fine).toEqual([{ startS: 0, endS: 2, action: "screw wheel", verb: "screw", noun: "wheel", clipped: false }]);
  }, 120_000);

  it("rejects a stretch outside 1-180 s or a missing view", async () => {
    const base = {
      recordingsDir: path.join(dataDir, "external", "recordings"),
      annotationsDir: path.join(dataDir, "external", "annotations"),
      recording: REC,
      views: { A: "C10115", B: "C10118", C: "C10395", D: "C10119" },
      sceneId: "a101_bad",
    };
    await expect(importAssembly101({ ...base, startS: 5, endS: 5 })).rejects.toThrow();
    await expect(importAssembly101({ ...base, startS: 0, endS: 4, views: { ...base.views, D: "C99999" } })).rejects.toThrow(/C99999/);
  });
});
