// OWNER: Dev 1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { HAS_FFMPEG } from "@/lib/video/testing";
import { activityBox, sceneRoi } from "@/lib/capture/roi";

const W = 64;
const H = 48;
function frame(fill = 50): Uint8Array {
  return new Uint8Array(W * H).fill(fill);
}
function blob(f: Uint8Array, x: number, y: number, size = 6) {
  for (let j = y; j < y + size; j++) for (let i = x; i < x + size; i++) f[j * W + i] = 220;
}

describe("activityBox", () => {
  it("boxes where things move, with a margin, ignoring excluded (flash) frames", () => {
    const frames = Array.from({ length: 60 }, (_, k) => {
      const f = frame();
      blob(f, 10 + Math.floor(k / 3), 20);
      return f;
    });
    frames[30] = frame(255); // a full-frame flash
    const box = activityBox(frames, W, H, new Set([30]))!;
    expect(box).not.toBeNull();
    // the blob travels x = 10..35, y = 20..25 (in 64x48 pixels)
    expect(box.x0 * W).toBeLessThanOrEqual(10);
    expect(box.x1 * W).toBeGreaterThanOrEqual(35);
    expect(box.y0 * H).toBeLessThanOrEqual(20);
    expect(box.y1 * H).toBeGreaterThanOrEqual(26);
    // it is a crop, not the whole frame
    expect((box.x1 - box.x0) * (box.y1 - box.y0)).toBeLessThan(0.7);
    for (const v of [box.x0, box.y0, box.x1, box.y1]) expect(v >= 0 && v <= 1).toBe(true);
  });

  it("ignores whole-frame changes (flashes) even when not told about them", () => {
    const frames = Array.from({ length: 60 }, (_, k) => {
      const f = frame();
      blob(f, 10 + Math.floor(k / 3), 20);
      return f;
    });
    frames[30] = frame(255);
    frames[31] = frame(255);
    const box = activityBox(frames, W, H, new Set())!;
    expect(box.y0 * H).toBeGreaterThan(5);
    expect((box.x1 - box.x0) * (box.y1 - box.y0)).toBeLessThan(0.7);
  });

  it("returns null when nothing moves, or only the excluded flash changes", () => {
    const still = Array.from({ length: 30 }, () => frame());
    expect(activityBox(still, W, H, new Set())).toBeNull();
    still[10] = frame(255);
    expect(activityBox(still, W, H, new Set([10]))).toBeNull();
  });

  it("keeps a minimum size so the surrounding context stays in view", () => {
    const frames = Array.from({ length: 30 }, (_, k) => {
      const f = frame();
      if (k % 2) blob(f, 30, 22, 2);
      return f;
    });
    const box = activityBox(frames, W, H, new Set())!;
    expect(box.x1 - box.x0).toBeGreaterThanOrEqual(0.4 - 1e-9);
    expect(box.y1 - box.y0).toBeGreaterThanOrEqual(0.4 - 1e-9);
  });
});

let dir: string;
beforeAll(() => {
  if (!HAS_FFMPEG) return;
  dir = mkdtempSync(path.join(tmpdir(), "rashomon-roi-"));
  // a 40x40 white square sliding across the left half of a 640x480 frame
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x303030:s=640x480:r=15:d=4",
    "-f", "lavfi", "-i", "color=c=white:s=40x40:r=15:d=4",
    "-filter_complex", "[0][1]overlay=x='40+t*50':y=300",
    "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", path.join(dir, "moving.webm"),
  ]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}, 60_000);
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!HAS_FFMPEG)("sceneRoi", () => {
  it("returns an even pixel crop box around the moving object", async () => {
    const box = (await sceneRoi(path.join(dir, "moving.webm")))!;
    expect(box).not.toBeNull();
    expect(box.x).toBeLessThanOrEqual(40);
    expect(box.x + box.w).toBeGreaterThanOrEqual(280);
    expect(box.y).toBeLessThanOrEqual(300);
    expect(box.y + box.h).toBeGreaterThanOrEqual(340);
    expect(box.x + box.w).toBeLessThan(640);
    for (const v of [box.x, box.y, box.w, box.h]) expect(v % 2).toBe(0);
  });
});
