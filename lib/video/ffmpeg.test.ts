// OWNER: Dev 1. Builds a synthetic webm (like the phones record) in a temp dir; no video is committed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { audio, clip, crop, grayFrames, probe, remux, segments, still, stills } from "@/lib/video/ffmpeg";
import { HAS_FFMPEG } from "@/lib/video/testing";

let dir: string;
let src: string;

beforeAll(() => {
  if (!HAS_FFMPEG) return;
  dir = mkdtempSync(path.join(tmpdir(), "rashomon-ffmpeg-"));
  src = path.join(dir, "cam-A.webm");
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6",
    "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "500k", "-c:a", "libopus", "-shortest", src,
  ]);
  if (r.status !== 0) throw new Error(`fixture failed: ${r.stderr.toString()}`);
}, 60_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const out = (name: string) => path.join(dir, "out", name);

describe.skipIf(!HAS_FFMPEG)("probe", () => {
  it("reads duration and size", async () => {
    const p = await probe(src);
    expect(p.durationS).toBeGreaterThan(5.8);
    expect(p.durationS).toBeLessThan(6.2);
    expect(p).toMatchObject({ width: 1280, height: 720 });
  });

  it("rejects a missing file", async () => {
    await expect(probe(path.join(dir, "nope.webm"))).rejects.toThrow();
  });
});

describe.skipIf(!HAS_FFMPEG)("clip", () => {
  it("cuts the window to a small mp4 with no audio", async () => {
    const o = await clip(src, 1, 3.5, out("c.mp4"));
    expect(o).toBe(out("c.mp4"));
    const p = await probe(o);
    expect(p.durationS).toBeGreaterThan(2.3);
    expect(p.durationS).toBeLessThan(2.7);
    expect(p.width).toBeLessThanOrEqual(640);
    expect(p.hasAudio).toBe(false);
  });

  it("refuses clips longer than CLIP_MAX_S or empty windows", async () => {
    await expect(clip(src, 0, 4.5, out("long.mp4"))).rejects.toThrow(/4/);
    await expect(clip(src, 2, 2, out("empty.mp4"))).rejects.toThrow();
    await expect(clip(src, -1, 1, out("neg.mp4"))).rejects.toThrow();
  });
});

describe.skipIf(!HAS_FFMPEG)("still", () => {
  it("saves one low-res jpeg", async () => {
    const o = await still(src, 2, out("s.jpg"), 320);
    const p = await probe(o);
    expect(p.width).toBe(320);
    expect(p.height).toBe(180);
  });

  it("throws when the time is past the end", async () => {
    await expect(still(src, 30, out("late.jpg"))).rejects.toThrow();
  });
});

describe.skipIf(!HAS_FFMPEG)("crop", () => {
  it("crops a still", async () => {
    const s = await still(src, 1, out("full.jpg"), 1280);
    const o = await crop(s, { x: 100, y: 50, w: 200, h: 120 }, out("crop.jpg"));
    expect(await probe(o)).toMatchObject({ width: 200, height: 120 });
  });

  it("crops a clip", async () => {
    const c = await clip(src, 0, 2, out("c2.mp4"));
    const o = await crop(c, { x: 0, y: 0, w: 160, h: 90 }, out("c2-crop.mp4"));
    const p = await probe(o);
    expect(p).toMatchObject({ width: 160, height: 90 });
    expect(p.durationS).toBeGreaterThan(1.8);
  });

  it("rejects a bad box", async () => {
    await expect(crop(src, { x: 0, y: 0, w: 0, h: 10 }, out("bad.jpg"))).rejects.toThrow();
  });
});

describe.skipIf(!HAS_FFMPEG)("audio", () => {
  it("extracts mono 16 kHz PCM wav", async () => {
    const o = await audio(src, out("a.wav"));
    const p = await probe(o);
    expect(p.sampleRate).toBe(16_000);
    expect(p.channels).toBe(1);
    // ~6 s * 16000 samples * 2 bytes
    expect(statSync(o).size).toBeGreaterThan(180_000);
    expect(existsSync(o)).toBe(true);
  });
});

describe.skipIf(!HAS_FFMPEG)("remux", () => {
  it("rewrites the container without re-encoding", async () => {
    const o = await remux(src, out("remux.webm"));
    const p = await probe(o);
    expect(p.durationS).toBeGreaterThan(5.8);
    expect(p).toMatchObject({ width: 1280, height: 720, hasAudio: true });
  });

  it("refuses to overwrite its input", async () => {
    await expect(remux(src, src)).rejects.toThrow();
  });
});

describe.skipIf(!HAS_FFMPEG)("grayFrames", () => {
  it("decodes constant-fps tiny gray frames", async () => {
    const g = await grayFrames(src, 16, 9, 10);
    expect(g.frames.length).toBeGreaterThanOrEqual(58);
    expect(g.frames.length).toBeLessThanOrEqual(61);
    expect(g.frames[0]!.length).toBe(16 * 9);
  });
});

describe.skipIf(!HAS_FFMPEG)("segments", () => {
  it("cuts equal 0.5 s segments", async () => {
    const files = await segments(src, 1, 0.5, 4, out("seg"));
    expect(files).toHaveLength(4);
    for (const f of files) {
      const p = await probe(f);
      expect(p.durationS).toBeGreaterThan(0.4);
      expect(p.durationS).toBeLessThan(0.6);
      expect(p.width).toBeLessThanOrEqual(640);
    }
  });

  it("rejects bad arguments", async () => {
    await expect(segments(src, 0, 5, 1, out("bad"))).rejects.toThrow();
    await expect(segments(src, 0, 0.5, 0, out("bad"))).rejects.toThrow();
  });
});

describe.skipIf(!HAS_FFMPEG)("stills", () => {
  it("saves one still per interval", async () => {
    const files = await stills(src, 0.25, 0.5, 6, out("stills"), 256);
    expect(files).toHaveLength(6);
    expect((await probe(files[0]!)).width).toBe(256);
  });
});
