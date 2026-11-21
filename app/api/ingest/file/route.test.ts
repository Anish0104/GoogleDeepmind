// OWNER: Dev 1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { HAS_FFMPEG } from "@/lib/video/testing";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-upload-"));
process.env.DATA_DIR = dataDir;

const { createScene } = await import("@/lib/store/scene");
const { probe } = await import("@/lib/video/ffmpeg");
const { POST } = await import("@/app/api/ingest/file/route");

/** A 2 s test video in the given container; `audio` adds a sine tone (what clap sync listens to). */
function video(format: "webm" | "mp4" | "mov", audio: boolean): Uint8Array<ArrayBuffer> {
  const out = path.join(dataDir, `fixture-${format}-${audio}.${format}`);
  const codec = format === "webm" ? ["-c:v", "libvpx", "-b:v", "200k"] : ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
  const a = audio ? ["-f", "lavfi", "-i", "sine=frequency=1000:duration=2"] : [];
  const ac = audio ? (format === "webm" ? ["-c:a", "libopus"] : ["-c:a", "aac"]) : [];
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2", ...a, ...codec, ...ac, "-shortest", out,
  ]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return new Uint8Array(readFileSync(out));
}

let webm: Uint8Array<ArrayBuffer>, mp4: Uint8Array<ArrayBuffer>, mov: Uint8Array<ArrayBuffer>;
beforeAll(async () => {
  if (!HAS_FFMPEG) return;
  webm = video("webm", true);
  mp4 = video("mp4", false);
  mov = video("mov", true);
  await createScene({ split: "dev", room: "r1", cameras: ["A", "B"], excludedCameras: [] }, { id: "u1" });
}, 60_000);
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

function post(fields: Record<string, string | Blob>): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request("http://localhost/api/ingest/file", { method: "POST", body: form });
}
const scene = (f: string) => path.join(dataDir, "scenes", "u1", f);

describe.skipIf(!HAS_FFMPEG)("POST /api/ingest/file (one whole video per camera)", { timeout: 60_000 }, () => {
  it("saves a webm as the camera's recording and reports duration and audio", async () => {
    const res = await POST(post({ sceneId: "u1", camera: "A", file: new Blob([webm], { type: "video/webm" }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, camera: "A", hasAudio: true });
    expect(body.durationS).toBeGreaterThan(1.8);
    expect(body.file).toBe(scene("cam-A.webm"));
    expect(existsSync(scene("cam-A.webm"))).toBe(true);
  });

  it("turns an iPhone .mov into cam-<X>.mp4 and replaces an earlier recording in the other container", async () => {
    const res = await POST(post({ sceneId: "u1", camera: "A", file: new Blob([mov], { type: "video/quicktime" }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.file).toBe(scene("cam-A.mp4"));
    expect(existsSync(scene("cam-A.webm"))).toBe(false); // would otherwise shadow the new one
    expect((await probe(scene("cam-A.mp4"))).durationS).toBeGreaterThan(1.8);
  });

  it("warns when there is no audio track (clap sync needs one unless the scene is presynced)", async () => {
    const res = await POST(post({ sceneId: "u1", camera: "B", file: new Blob([mp4], { type: "video/mp4" }) }));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, hasAudio: false });
    expect(body.warning).toMatch(/no audio/i);
  });

  it("does not warn about missing audio for a presynced scene", async () => {
    await createScene({ split: "dev", room: "r1", cameras: ["A"], excludedCameras: [], presynced: true }, { id: "u2" });
    const body = await (await POST(post({ sceneId: "u2", camera: "A", file: new Blob([mp4], { type: "video/mp4" }) }))).json();
    expect(body).toMatchObject({ ok: true, hasAudio: false });
    expect(body.warning).toBeUndefined();
  });

  it("accepts a file by extension when the browser sends no type", async () => {
    const res = await POST(post({ sceneId: "u1", camera: "B", file: new File([webm], "phone-b.webm") }));
    expect(res.status).toBe(200);
    expect((await res.json()).file).toBe(scene("cam-B.webm"));
  });

  it("rejects bad requests with 400 and unknown scenes with 404", async () => {
    const bad = async (fields: Record<string, string | Blob>, status: number, msg: RegExp) => {
      const res = await POST(post(fields));
      expect(res.status).toBe(status);
      expect((await res.json()).error).toMatch(msg);
    };
    await bad({ sceneId: "u1", camera: "A" }, 400, /file/);
    await bad({ sceneId: "u1", camera: "C", file: new Blob([webm], { type: "video/webm" }) }, 400, /camera C is not part/);
    await bad({ sceneId: "u1", camera: "A", file: new Blob([webm], { type: "image/png" }) }, 400, /unsupported/);
    await bad({ sceneId: "u1", camera: "A", file: new Blob([new Uint8Array(500).fill(7)], { type: "video/mp4" }) }, 400, /not a playable video/);
    await bad({ sceneId: "../x", camera: "A", file: new Blob([webm], { type: "video/webm" }) }, 400, /sceneId/);
    await bad({ sceneId: "nope", camera: "A", file: new Blob([webm], { type: "video/webm" }) }, 404, /nope/);
  });

  it("a rejected file leaves the camera's existing recording untouched", async () => {
    await POST(post({ sceneId: "u1", camera: "B", file: new Blob([webm], { type: "video/webm" }) }));
    await POST(post({ sceneId: "u1", camera: "B", file: new Blob([new Uint8Array(500).fill(7)], { type: "video/webm" }) }));
    expect((await probe(scene("cam-B.webm"))).durationS).toBeGreaterThan(1.8);
  });
});
