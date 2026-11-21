// OWNER: Dev 1.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HAS_FFMPEG } from "@/lib/video/testing";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-perceive-"));
process.env.DATA_DIR = dataDir;

const generateJson = vi.fn(async () => ({
  entities: [{ id: "red_cup", description: "red cup" }],
  people: [],
}));
const decide = vi.fn(async (_p: unknown, qs: { id: string }[]) => Object.fromEntries(qs.map((q) => [q.id, 0.7])));
vi.mock("@/lib/gemini/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/gemini/client")>()),
  generateJson: (...a: unknown[]) => generateJson(...(a as [])),
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

describe.skipIf(!HAS_FFMPEG)("perceiveScene", () => {
  it("runs sync, slicing, scout and lattice, writing every step's file", async () => {
    const onStep = vi.fn();
    const res = await perceiveScene("p1", { maxSlicesPerCamera: 3, onStep });
    const dir = path.join(dataDir, "scenes", "p1");
    for (const f of ["sync.json", "slices.json", "entities.json", "questions.json", "grid.jsonl"]) {
      expect(existsSync(path.join(dir, f))).toBe(true);
    }
    expect(res.sync.find((s) => s.camera === "B")!.offsetS).toBeCloseTo(1, 1);
    expect(res.slicesUsed).toBe(6);
    expect(res.rows).toBe(6 * res.questions);
    const grid = readFileSync(path.join(dir, "grid.jsonl"), "utf8").trim().split("\n");
    expect(grid).toHaveLength(res.rows);
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["sync", "slice", "scout", "lattice"]);
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
