// OWNER: Dev 1.
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-kille-"));
process.env.DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const decide = vi.fn(async (_parts: unknown, qs: { id: string }[]) => {
  await new Promise((r) => setTimeout(r, 5));
  return Object.fromEntries(qs.map((q) => [q.id, 0.5]));
});
vi.mock("@/lib/gemini/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/gemini/client")>()),
  decide: (...a: unknown[]) => decide(...(a as [unknown, { id: string }[]])),
}));

const { judgeSpeed, pickSlices, runKillTestE, KILL_TEST_E } = await import("./e");

const slice = (camera: string, t: number) => ({ camera, t, durationS: 0.5, path: `/x/${camera}-${t}.mp4`, stillPath: "" });

describe("judgeSpeed", () => {
  const ok = { wallMs: 8_000, expected: 120, answered: 120, rateLimited: 0, failures: 0 };
  it("passes when every slice is answered within the limit with no rate limiting", () => {
    expect(judgeSpeed(ok)).toEqual({ pass: true, failures: [] });
    expect(KILL_TEST_E).toMatchObject({ CAMERAS: 4, SLICES_PER_CAMERA: 30, MAX_MS: 10_000 });
  });
  it("fails on time, missing answers, rate limits or failed calls, saying which", () => {
    const r = judgeSpeed({ wallMs: 12_500, expected: 120, answered: 118, rateLimited: 3, failures: 2 });
    expect(r.pass).toBe(false);
    expect(r.failures.join(" | ")).toMatch(/12\.5 s > 10 s/);
    expect(r.failures.join(" | ")).toMatch(/118 of 120/);
    expect(r.failures.join(" | ")).toMatch(/3 rate-limit/);
    expect(r.failures.join(" | ")).toMatch(/2 failed/);
  });
});

describe("pickSlices", () => {
  it("takes the first N slices of each of the first 4 cameras", () => {
    const all = ["A", "B", "C", "D"].flatMap((c) => [0, 0.5, 1, 1.5].map((t) => slice(c, t)));
    const got = pickSlices(all as never, 4, 3);
    expect(got).toHaveLength(12);
    expect(new Set(got.map((s) => s.camera))).toEqual(new Set(["A", "B", "C", "D"]));
    expect(Math.max(...got.map((s) => s.t))).toBe(1);
  });
  it("refuses a scene with too few cameras or slices", () => {
    expect(() => pickSlices([slice("A", 0)] as never, 4, 30)).toThrow(/needs 4 cameras/);
    const short = ["A", "B", "C", "D"].flatMap((c) => [0, 0.5].map((t) => slice(c, t)));
    expect(() => pickSlices(short as never, 4, 30)).toThrow(/30 slices/);
  });
});

describe("runKillTestE", () => {
  it("answers 4 x N slices in parallel, without writing the grid, and times it", async () => {
    const scene = path.join(dataDir, "scenes", "e1");
    mkdirSync(path.join(scene, "slices"), { recursive: true });
    const slices = ["A", "B", "C", "D"].flatMap((c) =>
      [0, 0.5, 1].map((t) => {
        const p = path.join(scene, "slices", `${c}-${t}.mp4`);
        writeFileSync(p, "fake");
        return { camera: c, t, durationS: 0.5, path: p, stillPath: p };
      }),
    );
    writeFileSync(path.join(scene, "slices.json"), JSON.stringify(slices));
    writeFileSync(
      path.join(scene, "questions.json"),
      JSON.stringify([{ id: "x:visible:yes", entityId: "x", predicate: "visible", value: "yes", text: "Is x visible?" }]),
    );
    decide.mockClear();
    const r = await runKillTestE({ sceneId: "e1", slicesPerCamera: 3 });
    expect(r.expected).toBe(12);
    expect(r.answered).toBe(12);
    expect(decide).toHaveBeenCalledTimes(12); // one call per slice, no context clips
    expect(r.wallMs).toBeGreaterThan(0);
    expect(r.pass).toBe(true);
  });
});
