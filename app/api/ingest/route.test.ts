// OWNER: Dev 1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { HAS_FFMPEG } from "@/lib/video/testing";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-route-"));
process.env.DATA_DIR = dataDir;

const { createScene } = await import("@/lib/store/scene");
const { POST } = await import("@/app/api/ingest/route");

let recording: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  if (!HAS_FFMPEG) return;
  const r = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2",
      "-c:v", "libvpx", "-b:v", "200k", "-f", "webm", "pipe:1",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  recording = new Uint8Array(r.stdout);
  await createScene({ split: "starter", room: "r1", cameras: ["A"], excludedCameras: [] }, { id: "s1" });
}, 60_000);

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

function post(fields: Record<string, string | Blob>): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request("http://localhost/api/ingest", { method: "POST", body: form });
}

describe.skipIf(!HAS_FFMPEG)("POST /api/ingest", { timeout: 60_000 }, () => {
  it("accepts chunks, then finalizes on done=1", async () => {
    const half = Math.ceil(recording.length / 2);
    for (const [seq, part] of [recording.subarray(0, half), recording.subarray(half)].entries()) {
      const res = await POST(
        post({ sceneId: "s1", camera: "A", seq: String(seq), chunk: new Blob([part], { type: "video/webm" }) }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true });
    }
    const done = await POST(post({ sceneId: "s1", camera: "A", done: "1" }));
    expect(done.status).toBe(200);
    const body = await done.json();
    expect(body).toMatchObject({ ok: true, chunks: 2, missing: [] });
    expect(body.durationS).toBeGreaterThan(1.8);
  });

  it("returns 404 for an unknown scene", async () => {
    const res = await POST(post({ sceneId: "nope", camera: "A", seq: "0", chunk: new Blob([recording], { type: "video/webm" }) }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for bad fields", async () => {
    const chunk = new Blob([recording], { type: "video/webm" });
    expect((await POST(post({ sceneId: "s1", camera: "Z", seq: "0", chunk }))).status).toBe(400);
    expect((await POST(post({ sceneId: "s1", camera: "A", seq: "x", chunk }))).status).toBe(400);
    expect((await POST(post({ sceneId: "s1", camera: "A", seq: "0" }))).status).toBe(400);
    expect((await POST(post({ sceneId: "../etc", camera: "A", seq: "0", chunk }))).status).toBe(400);
    expect(
      (await POST(new Request("http://localhost/api/ingest", { method: "POST", body: "not a form" }))).status,
    ).toBe(400);
  });
});
