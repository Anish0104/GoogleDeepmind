// OWNER: Dev 1.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Claim } from "@/lib/types";
import { HAS_FFMPEG } from "@/lib/video/testing";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-cw-"));
process.env.DATA_DIR = dataDir;

const decide = vi.fn();
vi.mock("@/lib/gemini/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/gemini/client")>()),
  decide: (...a: unknown[]) => decide(...a),
}));

const { checkWindow, clipParts, clipPath } = await import("@/lib/perception/checkWindow");
const { probe } = await import("@/lib/video/ffmpeg");


const claim: Claim = {
  id: "c1",
  sceneId: "s1",
  text: "I put the red cup in zone C",
  actor: "speaker",
  object: "red cup",
  action: "put in zone C",
  window: [1, 3],
  timeIsPrecise: true,
};

const base = { sceneId: "s1", camera: "A" as const, window: [1, 3] as [number, number], crop: "full" as const, claim, source: "initial" as const };

beforeAll(() => {
  if (!HAS_FFMPEG) return;
  const sceneDir = path.join(dataDir, "scenes", "s1");
  mkdirSync(sceneDir, { recursive: true });
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=6",
    "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "500k", path.join(sceneDir, "cam-A.webm"),
  ]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}, 180_000);

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

beforeEach(() => {
  decide.mockReset();
  decide.mockResolvedValue({ visible: 0.92, supports: 0.85, contradicts: 0.04 });
});

describe.skipIf(!HAS_FFMPEG)("checkWindow", { timeout: 60_000 }, () => {
  it("cuts the clip, asks Decision 1 and returns Evidence", async () => {
    const ev = await checkWindow(base);
    expect(ev).toEqual({
      camera: "A",
      window: [1, 3],
      visible: 0.92,
      supports: 0.85,
      contradicts: 0.04,
      clipId: expect.any(String),
      source: "initial",
    });
    const file = clipPath("s1", ev.clipId);
    expect(existsSync(file)).toBe(true);
    const p = await probe(file);
    expect(p.durationS).toBeGreaterThan(1.8);
    expect(p.durationS).toBeLessThan(2.2);
  });

  it("sends only the clip and the claim text, with a cost purpose", async () => {
    await checkWindow({ ...base, source: "skeptic" });
    const [parts, questions, ctx] = decide.mock.calls[0]!;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ kind: "media", mimeType: "video/mp4" });
    expect(parts[1].text).toContain("I put the red cup in zone C");
    expect(questions.map((q: { id: string; kind: string }) => [q.id, q.kind])).toEqual([
      ["visible", "noul"],
      ["supports", "noul"],
      ["contradicts", "noul"],
    ]);
    expect(questions[0].text).toContain("red cup");
    expect(ctx).toEqual({ purpose: "checkWindow:skeptic", sceneId: "s1" });
  });

  it("gives each window its own clipId and reuses an existing clip", async () => {
    const a = await checkWindow(base);
    const b = await checkWindow(base);
    const c = await checkWindow({ ...base, window: [2, 4] });
    expect(a.clipId).toBe(b.clipId);
    expect(c.clipId).not.toBe(a.clipId);
  });

  it("turns a clipId back into a video part", async () => {
    const ev = await checkWindow(base);
    const [part] = clipParts("s1", ev.clipId);
    expect(part).toMatchObject({ kind: "media", mimeType: "video/mp4" });
    expect(() => clipParts("s1", "../../etc")).toThrow();
    expect(() => clipParts("s1", "A_9.00-10.00_full")).toThrow(/not found/);
  });

  it("rejects windows outside 1-4 s before any model call", async () => {
    await expect(checkWindow({ ...base, window: [1, 1.5] })).rejects.toThrow();
    await expect(checkWindow({ ...base, window: [0, 4.5] })).rejects.toThrow();
    await expect(checkWindow({ ...base, window: [-1, 1] })).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
  });

  it("throws when the camera has no recording", async () => {
    await expect(checkWindow({ ...base, camera: "B" })).rejects.toThrow(/cam-B/);
    expect(decide).not.toHaveBeenCalled();
  });

  it("rejects a decision result that is not a probability", async () => {
    decide.mockResolvedValue({ visible: 0.9, supports: { yes: 1 }, contradicts: 0.1 });
    await expect(checkWindow(base)).rejects.toThrow();
  });
});
