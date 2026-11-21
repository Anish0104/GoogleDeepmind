// OWNER: Dev 1.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HAS_FFMPEG } from "@/lib/video/testing";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-perceive-"));
process.env.DATA_DIR = dataDir;

const generateJson = vi.fn(async (_m: unknown, _p: unknown, _s: unknown, ctx: { purpose: string }) =>
  ctx.purpose === "views"
    ? { views: ["A", "B"].map((camera) => ({ camera, text: `camera ${camera}: eye level, side-on` })) }
    : { entities: [{ id: "red_cup", description: "red cup" }], people: [] },
);
const decide = vi.fn(async (_p: unknown, qs: { id: string }[]) => Object.fromEntries(qs.map((q) => [q.id, 0.7])));
vi.mock("@/lib/gemini/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/gemini/client")>()),
  generateJson: (...a: unknown[]) => generateJson(...(a as [unknown, unknown, unknown, { purpose: string }])),
  decide: (...a: unknown[]) => decide(...(a as [unknown, { id: string }[]])),
}));

const { perceiveScene } = await import("@/lib/perception/perceive");
const { makeSyncFixture } = await import("@/lib/capture/synthetic");
const { createScene } = await import("@/lib/store/scene");

beforeAll(async () => {
  if (!HAS_FFMPEG) return;
  await createScene({ split: "starter", room: "r1", cameras: ["A", "B"], excludedCameras: [] }, { id: "p1" });
  await makeSyncFixture(path.join(dataDir, "scenes", "p1"), { A: 2.0, B: 3.0 }, { durationS: 6 });
  await createScene({ split: "dev", room: "r1", cameras: ["A", "B"], excludedCameras: [] }, { id: "pre1" });
  await makeSyncFixture(path.join(dataDir, "scenes", "pre1"), { A: 2.0, B: 2.0 }, { durationS: 6 });
}, 120_000);

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe.skipIf(!HAS_FFMPEG)("perceiveScene", { timeout: 60_000 }, () => {
  it("runs sync, slicing, scout and lattice, writing every step's file", async () => {
    const onStep = vi.fn();
    const res = await perceiveScene("p1", { maxSlicesPerCamera: 3, onStep });
    const dir = path.join(dataDir, "scenes", "p1");
    for (const f of ["sync.json", "slices.json", "views.json", "entities.json", "questions.json", "grid.jsonl"]) {
      expect(existsSync(path.join(dir, f))).toBe(true);
    }
    expect(res.sync.find((s) => s.camera === "B")!.offsetS).toBeCloseTo(1, 1);
    expect(res.slicesUsed).toBe(6);
    expect(res.rows).toBe(6 * res.questions);
    const grid = readFileSync(path.join(dir, "grid.jsonl"), "utf8").trim().split("\n");
    expect(grid).toHaveLength(res.rows);
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["sync", "slice", "views", "scout", "lattice"]);
    // scout saw one still per camera
    const parts = (generateJson.mock.calls[0] as unknown as [string, { kind: string }[]])[1];
    expect(parts.filter((p) => p.kind === "media")).toHaveLength(2);
  }, 120_000);

  it("uses a fixed question set instead of scout's questions when given", async () => {
    const { WAREHOUSE_QUESTIONS } = await import("@/lib/perception/questionSets");
    const res = await perceiveScene("p1", {
      maxSlicesPerCamera: 2,
      questions: WAREHOUSE_QUESTIONS,
      roi: true,
      contextQuestionIds: ["forklift:state:stationary"],
    });
    expect(existsSync(path.join(dataDir, "scenes", "p1", "roi.json"))).toBe(true);
    expect(res.questions).toBe(WAREHOUSE_QUESTIONS.length);
    expect(res.rows).toBe(4 * WAREHOUSE_QUESTIONS.length);
    const saved = JSON.parse(readFileSync(path.join(dataDir, "scenes", "p1", "questions.json"), "utf8"));
    expect(saved.map((q: { id: string }) => q.id)).toEqual(WAREHOUSE_QUESTIONS.map((q) => q.id));
  }, 120_000);

  it("with a named question set, writes the set's entities, people and questions and skips scout", async () => {
    const { questionSet } = await import("@/lib/perception/questionSets");
    const set = questionSet("sdg-nearmiss");
    generateJson.mockClear();
    decide.mockClear();
    const onStep = vi.fn();
    const res = await perceiveScene("pre1", { maxSlicesPerCamera: 2, presynced: true, questionSet: "sdg-nearmiss", onStep });
    expect(generateJson.mock.calls.map((c) => c[3].purpose)).toEqual(["views"]); // views only, no scout call
    const read = (f: string) => JSON.parse(readFileSync(path.join(dataDir, "scenes", "pre1", f), "utf8"));
    expect(read("entities.json")).toEqual(set.entities);
    expect(read("people.json")).toEqual(set.people);
    expect(read("questions.json").map((q: { id: string }) => q.id)).toEqual(set.questions.map((q) => q.id));
    expect(res.entities).toBe(2);
    expect(res.rows).toBe(4 * set.questions.length);
    // motion questions went to the context clips: one extra decide() per slice
    expect(decide).toHaveBeenCalledTimes(2 * 4);
    expect(onStep.mock.calls.find((c) => c[0] === "scout")![1]).toMatch(/question set sdg-nearmiss/);
  }, 120_000);

  it("writes views.json from one still per camera, and still finishes if that call fails", async () => {
    const res = await perceiveScene("pre1", { maxSlicesPerCamera: 1, presynced: true, questionSet: "sdg-nearmiss" });
    expect(res.views).toBe(2);
    const views = JSON.parse(readFileSync(path.join(dataDir, "scenes", "pre1", "views.json"), "utf8"));
    expect(views.map((v: { camera: string }) => v.camera)).toEqual(["A", "B"]);
    generateJson.mockImplementationOnce(async () => {
      throw new Error("model down");
    });
    const onStep = vi.fn();
    const again = await perceiveScene("pre1", { maxSlicesPerCamera: 1, presynced: true, questionSet: "sdg-nearmiss", onStep });
    expect(again.views).toBe(0);
    expect(again.rows).toBeGreaterThan(0);
    expect(onStep.mock.calls.find((c) => c[0] === "views")![1]).toMatch(/failed: model down/);
  }, 120_000);

  it("scores every other slice with sliceStride: 2", async () => {
    const seen: Record<string, number[]> = {};
    const res = await perceiveScene("pre1", {
      presynced: true,
      questionSet: "sdg-nearmiss",
      sliceStride: 2,
      onRows: (rows) => (seen[rows[0]!.camera] ??= []).push(rows[0]!.t),
    });
    expect(res.slicesUsed).toBe(Math.ceil(res.slices / 2 / 2) * 2); // 2 cameras, every other slice each
    for (const ts of Object.values(seen)) {
      const sorted = [...ts].sort((a, b) => a - b);
      expect(sorted[0]).toBe(0);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeCloseTo(1, 9);
    }
  }, 120_000);

  it("skips sync for presynced footage: zero offsets, no sync.json", async () => {
    const onStep = vi.fn();
    const res = await perceiveScene("pre1", { maxSlicesPerCamera: 1, presynced: true, onStep });
    expect(res.presynced).toBe(true);
    expect(res.sync.map((s) => [s.camera, s.offsetS, s.driftPerMin])).toEqual([["A", 0, 0], ["B", 0, 0]]);
    expect(existsSync(path.join(dataDir, "scenes", "pre1", "sync.json"))).toBe(false);
    expect(onStep.mock.calls[0]![1]).toMatch(/presynced/);
    expect(res.slices).toBeGreaterThan(0);
  }, 120_000);
});
