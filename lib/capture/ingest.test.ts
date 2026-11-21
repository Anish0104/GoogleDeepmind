// OWNER: Dev 1. A webm written to a pipe has no duration or index, like a MediaRecorder recording.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { HAS_FFMPEG } from "@/lib/video/testing";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-ingest-"));
process.env.DATA_DIR = dataDir;

const { createScene } = await import("@/lib/store/scene");
const { IngestError, finalizeCamera, saveChunk } = await import("@/lib/capture/ingest");
const { probe } = await import("@/lib/video/ffmpeg");

let recording: Uint8Array;

function split(bytes: Uint8Array, n: number): Uint8Array[] {
  const size = Math.ceil(bytes.length / n);
  return Array.from({ length: n }, (_, i) => bytes.subarray(i * size, (i + 1) * size));
}

beforeAll(async () => {
  if (!HAS_FFMPEG) return;
  const r = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
      "-c:v", "libvpx", "-b:v", "300k", "-c:a", "libopus", "-shortest", "-f", "webm", "pipe:1",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  recording = new Uint8Array(r.stdout);
  for (const id of ["s1", "s2", "s3"]) {
    await createScene({ split: "starter", room: "r1", cameras: ["A", "B"], excludedCameras: [] }, { id });
  }
}, 60_000);

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const sceneFile = (id: string, f: string) => path.join(dataDir, "scenes", id, f);

describe.skipIf(!HAS_FFMPEG)("saveChunk + finalizeCamera", () => {
  it("joins chunks in seq order (any arrival order) into a playable file with a duration", async () => {
    const parts = split(recording, 4);
    for (const seq of [2, 0, 3, 1]) {
      await saveChunk({ sceneId: "s1", camera: "A", seq, data: parts[seq]!, mimeType: "video/webm;codecs=vp8,opus" });
    }
    const res = await finalizeCamera("s1", "A");
    expect(res).toMatchObject({ chunks: 4, missing: [], file: sceneFile("s1", "cam-A.webm") });
    expect(res.durationS).toBeGreaterThan(2.8);
    expect(res.durationS).toBeLessThan(3.3);
    const p = await probe(res.file);
    expect(p).toMatchObject({ width: 640, height: 360, hasAudio: true });
  });

  it("overwrites a chunk that is uploaded twice", async () => {
    const parts = split(recording, 2);
    await saveChunk({ sceneId: "s2", camera: "B", seq: 0, data: parts[0]!, mimeType: "video/webm" });
    await saveChunk({ sceneId: "s2", camera: "B", seq: 0, data: parts[0]!, mimeType: "video/webm" });
    await saveChunk({ sceneId: "s2", camera: "B", seq: 1, data: parts[1]!, mimeType: "video/webm" });
    expect((await finalizeCamera("s2", "B")).chunks).toBe(2);
  });

  it("reports missing chunks", async () => {
    const parts = split(recording, 3);
    await saveChunk({ sceneId: "s3", camera: "A", seq: 0, data: parts[0]!, mimeType: "video/webm" });
    await saveChunk({ sceneId: "s3", camera: "A", seq: 2, data: parts[2]!, mimeType: "video/webm" });
    const res = await finalizeCamera("s3", "A");
    expect(res.missing).toEqual([1]);
    expect(existsSync(res.file)).toBe(true);
  });

  it("rejects unknown scenes, cameras outside the scene, bad types and bad seq", async () => {
    const data = recording.subarray(0, 100);
    await expect(saveChunk({ sceneId: "nope", camera: "A", seq: 0, data, mimeType: "video/webm" })).rejects.toThrow(
      /not found/,
    );
    await expect(saveChunk({ sceneId: "s1", camera: "C", seq: 0, data, mimeType: "video/webm" })).rejects.toThrow(
      IngestError,
    );
    await expect(saveChunk({ sceneId: "s1", camera: "A", seq: 0, data, mimeType: "image/png" })).rejects.toThrow(
      IngestError,
    );
    await expect(saveChunk({ sceneId: "s1", camera: "A", seq: -1, data, mimeType: "video/webm" })).rejects.toThrow();
    await expect(
      saveChunk({ sceneId: "s1", camera: "A", seq: 0, data: new Uint8Array(0), mimeType: "video/webm" }),
    ).rejects.toThrow(IngestError);
  });

  it("refuses to finalize a camera with no chunks", async () => {
    await expect(finalizeCamera("s2", "A")).rejects.toThrow(IngestError);
  });
});
