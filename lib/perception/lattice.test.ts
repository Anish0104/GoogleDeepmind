// OWNER: Dev 1.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Question } from "@/lib/types";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-lattice-"));
process.env.DATA_DIR = dataDir;

const decide = vi.fn();
vi.mock("@/lib/gemini/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/gemini/client")>()),
  decide: (...a: unknown[]) => decide(...a),
}));

const { lattice, latticeScene } = await import("@/lib/perception/lattice");
const { buildQuestions } = await import("@/lib/perception/scout");

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const clipDir = path.join(dataDir, "clips");
mkdirSync(clipDir, { recursive: true });
const slice = (camera: "A" | "B", t: number) => {
  const p = path.join(clipDir, `${camera}-${t}.mp4`);
  writeFileSync(p, Buffer.from("fake mp4"));
  return { camera, t, durationS: 0.5, path: p, stillPath: p };
};

const questions: Question[] = buildQuestions(
  [
    { id: "red_cup", description: "red cup" },
    { id: "blue_box", description: "blue box", states: ["open"] },
  ],
  [],
);

/** Answers every question: visibility per entity, 0.9 for zone C, 0.1 otherwise. */
function answerAll(vis: Record<string, number>) {
  return async (_parts: unknown, qs: { id: string }[]) =>
    Object.fromEntries(
      qs.map((q) => {
        const [entity, predicate, value] = q.id.split(":");
        if (predicate === "visible") return [q.id, vis[entity!] ?? 0.5];
        return [q.id, value === "C" ? 0.9 : 0.1];
      }),
    );
}

const gridFile = (scene: string) => path.join(dataDir, "scenes", scene, "grid.jsonl");
const readGrid = (scene: string) =>
  readFileSync(gridFile(scene), "utf8").trim().split("\n").map((l) => JSON.parse(l));

beforeEach(() => {
  decide.mockReset();
  decide.mockImplementation(answerAll({ red_cup: 0.95, blue_box: 0.3 }));
});

describe("lattice", () => {
  it("returns one GridRow per question with pVisible from that entity's visible question", async () => {
    const rows = await lattice(slice("A", 1.5), questions, "s1");
    expect(rows).toHaveLength(questions.length);
    const c = rows.find((r) => r.questionId === "red_cup:location:C")!;
    expect(c).toEqual({ sceneId: "s1", camera: "A", t: 1.5, questionId: "red_cup:location:C", pYes: 0.9, pVisible: 0.95 });
    expect(rows.find((r) => r.questionId === "blue_box:state:open")!.pVisible).toBe(0.3);
    expect(rows.find((r) => r.questionId === "red_cup:visible:yes")!.pYes).toBe(0.95);
  });

  it("sends the slice video once with every question, tagged for cost", async () => {
    await lattice(slice("B", 2), questions, "s1");
    expect(decide).toHaveBeenCalledTimes(1);
    const [parts, qs, ctx] = decide.mock.calls[0]!;
    expect(parts[0]).toMatchObject({ kind: "media", mimeType: "video/mp4" });
    expect(parts[1].text).toContain("camera B");
    expect(parts[1].text).not.toMatch(/zone|mat/i);
    expect(qs.every((q: { kind: string }) => q.kind === "noul")).toBe(true);
    expect(qs).toHaveLength(questions.length);
    expect(ctx).toEqual({ purpose: "lattice", sceneId: "s1" });
  });

  it("appends rows to grid.jsonl, or not with write: false", async () => {
    await lattice(slice("A", 0), questions, "w1");
    expect(readGrid("w1")).toHaveLength(questions.length);
    await lattice(slice("A", 0), questions, "w2", { write: false });
    expect(existsSync(gridFile("w2"))).toBe(false);
  });

  it("adds a hidden visibility question when an entity has none", async () => {
    const noVis = questions.filter((q) => q.predicate !== "visible");
    const rows = await lattice(slice("A", 0), noVis, "s2", { write: false });
    expect(rows).toHaveLength(noVis.length);
    expect(rows.find((r) => r.questionId === "red_cup:location:A")!.pVisible).toBe(0.95);
    const asked = decide.mock.calls[0]![1].map((q: { id: string }) => q.id);
    expect(asked).toContain("red_cup:visible:yes");
  });

  it("splits large question sets by entity, repeating each entity's visibility question", async () => {
    const rows = await lattice(slice("A", 0), questions, "s3", { write: false, maxQuestionsPerCall: 12 });
    expect(decide.mock.calls.length).toBe(2);
    for (const [, qs] of decide.mock.calls) {
      const entities = new Set(qs.map((q: { id: string }) => q.id.split(":")[0]));
      for (const e of entities) expect(qs.some((q: { id: string }) => q.id === `${e}:visible:yes`)).toBe(true);
    }
    expect(rows).toHaveLength(questions.length);
  });

  it("rejects non-probability answers", async () => {
    decide.mockResolvedValue(Object.fromEntries(questions.map((q) => [q.id, { yes: 1 }])));
    await expect(lattice(slice("A", 0), questions, "s4", { write: false })).rejects.toThrow();
  });
});

describe("latticeScene", () => {
  it("runs every slice, streams rows per slice, and survives one failing slice", async () => {
    let n = 0;
    decide.mockImplementation(async (parts: unknown, qs: { id: string }[]) => {
      if (++n === 2) throw new Error("boom");
      return answerAll({ red_cup: 0.9, blue_box: 0.9 })(parts, qs);
    });
    const onRows = vi.fn();
    const slices = [slice("A", 0), slice("B", 0), slice("A", 0.5)];
    const rows = await latticeScene(slices, questions, "s5", onRows, { write: false });
    expect(onRows).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2 * questions.length);
    expect(rows.map((r) => r.t)).toEqual([...rows.map((r) => r.t)].sort((a, b) => a - b));
  });

  it("throws when every slice fails", async () => {
    decide.mockRejectedValue(new Error("quota"));
    await expect(latticeScene([slice("A", 0)], questions, "s6", undefined, { write: false })).rejects.toThrow(/quota/);
  });
});
