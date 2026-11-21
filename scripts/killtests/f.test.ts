// OWNER: Dev 1.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { HAS_FFMPEG } from "@/lib/video/testing";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-killf-"));
process.env.DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const generateJson = vi.fn();
vi.mock("@/lib/gemini/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/gemini/client")>()),
  generateJson: (...a: unknown[]) => generateJson(...a),
}));

const { judgeSync, readStopwatch, sampleTimes, syncErrors, runKillTestF, KILL_TEST_F } = await import("./f");
const { createScene } = await import("@/lib/store/scene");
const { grayFrames } = await import("@/lib/video/ffmpeg");

describe("sampleTimes", () => {
  it("spreads n times evenly over [start, end]", () => {
    expect(sampleTimes(1, 5, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(sampleTimes(2, 2, 1)).toEqual([2]);
  });
});

describe("syncErrors and judgeSync", () => {
  it("measures each camera's reading against the median reading at the same synced time", () => {
    const r = syncErrors([
      { t: 1, readings: { A: 10.0, B: 10.02, C: 9.99, D: null } },
      { t: 2, readings: { A: 11.0, B: 11.1, C: 11.0 } },
    ]);
    expect(r[0]!.median).toBeCloseTo(10.0, 9);
    expect(r[0]!.errors.B).toBeCloseTo(0.02, 9);
    expect(r[0]!.errors.D).toBeUndefined(); // unreadable: not scored
    expect(r[1]!.errors.B).toBeCloseTo(0.1, 9);
  });
  it("passes within one frame plus the timer's display step, and names the camera that is off", () => {
    const tol = KILL_TEST_F.FRAME_S + KILL_TEST_F.DISPLAY_STEP_S;
    const good = syncErrors([1, 2, 3].map((t) => ({ t, readings: { A: t, B: t + 0.02, C: t - 0.01 } })));
    expect(judgeSync(good)).toMatchObject({ pass: true, readable: 3 });
    const bad = syncErrors([1, 2, 3].map((t) => ({ t, readings: { A: t, B: t + tol + 0.05, C: t } })));
    const j = judgeSync(bad);
    expect(j.pass).toBe(false);
    expect(j.failures.join(" ")).toMatch(/camera B/);
  });
  it("needs enough moments where the timer was readable on at least two cameras", () => {
    const few = syncErrors([{ t: 1, readings: { A: 1, B: 1 } }, { t: 2, readings: { A: 2, B: null } }]);
    const j = judgeSync(few);
    expect(j.pass).toBe(false);
    expect(j.failures.join(" ")).toMatch(/readable/);
  });
});

/**
 * Camera c started recording `start[c]` s after camera A, filming a "timer" that shows the true time
 * as a white bar moving 50 px/s. A reader turns the bar position back into seconds.
 */
const start = { A: 0, B: 0.4, C: 1.1 } as const;
const PX_PER_S = 50;
async function barReader(stillPath: string): Promise<number | null> {
  const { frames } = await grayFrames(stillPath, 320, 180, 1);
  const row = frames[0]!.subarray(90 * 320, 91 * 320);
  const xs = [...row].map((v, i) => (v > 128 ? i : -1)).filter((i) => i >= 0);
  return xs.length ? (xs.reduce((s, x) => s + x, 0) / xs.length - 1.5) / PX_PER_S : null;
}

beforeAll(async () => {
  if (!HAS_FFMPEG) return;
  await createScene({ split: "dev", room: "r", cameras: ["A", "B", "C"], excludedCameras: [] }, { id: "f1" });
  const dir = path.join(dataDir, "scenes", "f1");
  mkdirSync(dir, { recursive: true });
  for (const [cam, s] of Object.entries(start)) {
    const r = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=5",
      "-f", "lavfi", "-i", "color=c=white:s=4x60:r=30:d=5",
      "-filter_complex", `[0:v][1:v]overlay=x='(t+${s})*${PX_PER_S}':y=60`,
      "-c:v", "libvpx", "-b:v", "400k", path.join(dir, `cam-${cam}.webm`),
    ]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
  }
}, 60_000);

const writeSync = (offsets: Record<string, number>) =>
  writeFileSync(
    path.join(dataDir, "scenes", "f1", "sync.json"),
    JSON.stringify(Object.entries(offsets).map(([camera, offsetS]) => ({ camera, offsetS, driftPerMin: 0, method: "both" }))),
  );

describe.skipIf(!HAS_FFMPEG)("runKillTestF", { timeout: 60_000 }, () => {
  // synced time = A's time; camera c's own time = synced - start[c], so offsetS = -start[c]
  it("passes when sync.json lines the cameras up", async () => {
    writeSync({ A: 0, B: -0.4, C: -1.1 });
    const r = await runKillTestF({ sceneId: "f1", reader: barReader, times: 4 });
    expect(r.pass).toBe(true);
    expect(r.maxErrorS).toBeLessThanOrEqual(KILL_TEST_F.FRAME_S);
    expect(r.moments).toHaveLength(4);
  });

  it("fails and names the camera when its offset is 0.2 s wrong", async () => {
    writeSync({ A: 0, B: -0.2, C: -1.1 });
    const r = await runKillTestF({ sceneId: "f1", reader: barReader, times: 4 });
    expect(r.pass).toBe(false);
    expect(r.failures.join(" ")).toMatch(/camera B/);
  });
});

describe("readStopwatch", () => {
  it("asks for the total in seconds including hundredths, with the still, tagged for cost", async () => {
    const img = path.join(dataDir, "s.jpg");
    writeFileSync(img, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    generateJson.mockResolvedValueOnce({ seconds: 83.45 });
    expect(await readStopwatch(img, "f1")).toBe(83.45);
    const [, parts, , ctx] = generateJson.mock.calls[0]!;
    expect(parts[0].text).toMatch(/hundredths/);
    expect(parts[1]).toMatchObject({ kind: "media", mimeType: "image/jpeg" });
    expect(ctx).toEqual({ purpose: "killtest-f", sceneId: "f1" });
    generateJson.mockResolvedValueOnce({ seconds: null });
    expect(await readStopwatch(img, "f1")).toBeNull();
  });
});
