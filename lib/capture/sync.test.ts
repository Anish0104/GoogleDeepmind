// OWNER: Dev 1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SceneManifest } from "@/lib/types";
import { HAS_FFMPEG } from "@/lib/video/testing";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-sync-"));
process.env.DATA_DIR = dataDir;

const { bestLag, estimateDrift, findFlashes, localTime, parseWav, syncScene } = await import("@/lib/capture/sync");
const { makeSyncFixture } = await import("@/lib/capture/synthetic");
const { createScene } = await import("@/lib/store/scene");

const FRAME = 1 / 30;
let manifest: SceneManifest;

beforeAll(async () => {
  if (!HAS_FFMPEG) return;
  manifest = await createScene(
    { split: "starter", room: "r1", cameras: ["A", "B", "C"], excludedCameras: [] },
    { id: "sync1" },
  );
  await makeSyncFixture(path.join(dataDir, "scenes", "sync1"), { A: 2.0, B: 4.4, C: 1.3 });
}, 120_000);

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("bestLag", () => {
  it("finds the shift that aligns b to a", () => {
    const a = new Float32Array(200);
    const b = new Float32Array(200);
    a[50] = 1;
    a[60] = 0.5;
    b[80] = 1;
    b[90] = 0.5;
    const r = bestLag(a, b, -100, 100);
    expect(r.lag).toBe(30);
    expect(r.score).toBeGreaterThan(0.99);
  });
});

describe("estimateDrift", () => {
  it("is seconds of extra offset per minute between the opening and closing flash", () => {
    expect(estimateDrift(1.0, 1.3, 60)).toBeCloseTo(0.3, 6);
    expect(estimateDrift(1.0, 0.8, 30)).toBeCloseTo(-0.4, 6);
  });

  it("ignores a change smaller than one frame of a 15 fps video (frame quantisation, not drift)", () => {
    expect(estimateDrift(1.1, 1.1 - 1 / 15, 21.3)).toBe(0);
    expect(estimateDrift(0.4, 0.45, 21.3)).toBe(0);
  });
});

describe("findFlashes", () => {
  it("finds short bright pulses in any cell, not lasting brightness changes", () => {
    const frames = Array.from({ length: 90 }, () => new Uint8Array(4).fill(40));
    for (let k = 30; k < 39; k++) frames[k]![1] = 250; // 0.3 s flash at 1.0 s
    for (let k = 60; k < 90; k++) frames[k]!.fill(200); // lights turned on, stays on
    expect(findFlashes(frames, 30)).toEqual([1]);
  });
});

describe("parseWav", () => {
  it("reads 16-bit mono PCM", () => {
    const n = 4;
    const buf = Buffer.alloc(44 + n * 2);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + n * 2, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(16000, 24);
    buf.writeUInt32LE(32000, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(n * 2, 40);
    [0, 16384, -32768, 32767].forEach((v, i) => buf.writeInt16LE(v, 44 + i * 2));
    const w = parseWav(buf);
    expect(w.sampleRate).toBe(16000);
    expect(Array.from(w.samples)).toEqual([0, 0.5, -1, 32767 / 32768]);
  });
});

describe.skipIf(!HAS_FFMPEG)("syncScene", { timeout: 60_000 }, () => {
  it("recovers known offsets within one frame and writes sync.json", async () => {
    const res = await syncScene(manifest);
    const by = Object.fromEntries(res.map((r) => [r.camera, r]));
    expect(by.A).toMatchObject({ offsetS: 0 });
    expect(Math.abs(by.B!.offsetS - 2.4)).toBeLessThanOrEqual(FRAME);
    expect(Math.abs(by.C!.offsetS - -0.7)).toBeLessThanOrEqual(FRAME);
    expect(by.B!.method).toBe("both");
    expect(Math.abs(by.B!.driftPerMin)).toBeLessThan(0.05);
    const file = path.join(dataDir, "scenes", "sync1", "sync.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(3);
  }, 60_000);
});

describe.skipIf(!HAS_FFMPEG)("localTime", { timeout: 60_000 }, () => {
  it("maps synced time to each camera's recording time from sync.json", async () => {
    const res = await syncScene(manifest);
    const b = res.find((r) => r.camera === "B")!;
    expect(await localTime("sync1", "B", 1)).toBeCloseTo(1 + b.offsetS + b.driftPerMin / 60, 6);
    expect(await localTime("sync1", "A", 1)).toBe(1);
    await expect(localTime("sync1", "D", 1)).rejects.toThrow(/D/);
  }, 60_000);

  it("is the identity without sync.json", async () => {
    await createScene({ split: "starter", room: "r1", cameras: ["A"], excludedCameras: [] }, { id: "nosync" });
    expect(await localTime("nosync", "A", 2.5)).toBe(2.5);
  });
});
