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

const concat = vi.fn(async (inputs: string[], out: string) => {
  writeFileSync(out, `joined:${inputs.length}`);
  return out;
});
vi.mock("@/lib/video/ffmpeg", async (orig) => ({
  ...(await orig<typeof import("@/lib/video/ffmpeg")>()),
  concat: (inputs: string[], out: string) => concat(inputs, out),
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

describe("motion questions on a longer context clip", () => {
  const motion = "blue_box:state:open";

  it("asks context questions about the context clip, everything else about the slice", async () => {
    const ctx = path.join(clipDir, "ctx.mp4");
    writeFileSync(ctx, "context clip bytes");
    const rows = await lattice(slice("A", 2), questions, "m1", {
      write: false,
      contextPath: ctx,
      contextQuestionIds: [motion],
    });
    expect(decide).toHaveBeenCalledTimes(2);
    const [mainParts, mainQs] = decide.mock.calls[0]!;
    const [ctxParts, ctxQs] = decide.mock.calls[1]!;
    expect(mainQs.map((q: { id: string }) => q.id)).not.toContain(motion);
    expect(ctxQs.map((q: { id: string }) => q.id)).toEqual([motion]);
    expect(ctxParts[0].data).not.toBe(mainParts[0].data);
    expect(ctxParts[1].text).toMatch(/clip/i);
    expect(rows).toHaveLength(questions.length);
    expect(rows.find((r) => r.questionId === motion)!.pVisible).toBe(0.3); // from the slice's visibility answer
  });

  it("falls back to the slice when no context clip is given", async () => {
    await lattice(slice("A", 2), questions, "m2", { write: false, contextQuestionIds: [motion] });
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("latticeScene builds each context clip from the slice before and the slices after", async () => {
    concat.mockClear();
    const slices = [0, 0.5, 1, 1.5, 2].map((t) => slice("B", t));
    await latticeScene(slices, questions, "m3", undefined, { write: false, contextQuestionIds: [motion], contextSlices: 4 });
    expect(concat).toHaveBeenCalledTimes(5);
    const byFirst = new Map(concat.mock.calls.map(([inputs]) => [inputs.length, inputs]));
    expect([...byFirst.keys()].every((n) => n >= 2 && n <= 4)).toBe(true);
    const mid = concat.mock.calls.find(([inputs]) => inputs.length === 4)![0];
    expect(mid.map((p: string) => path.basename(p))).toEqual(["B-0.mp4", "B-0.5.mp4", "B-1.mp4", "B-1.5.mp4"]);
    expect(decide).toHaveBeenCalledTimes(10);
  });

  it("scoring only some slices still builds context clips from every consecutive slice (contextFrom)", async () => {
    concat.mockClear();
    const all = [0, 0.5, 1, 1.5, 2, 2.5].map((t) => slice("A", t + 10));
    const every2 = all.filter((_, i) => i % 2 === 0);
    await latticeScene(every2, questions, "m4", undefined, { write: false, contextQuestionIds: [motion], contextSlices: 4, contextFrom: all });
    expect(decide).toHaveBeenCalledTimes(2 * every2.length);
    const forT11 = concat.mock.calls.map(([inputs]) => inputs.map((p: string) => path.basename(p))).find((n) => n[0] === "A-10.5.mp4")!;
    expect(forT11).toEqual(["A-10.5.mp4", "A-11.mp4", "A-11.5.mp4", "A-12.mp4"]); // no gaps
  });

  it("names cached context clips by length, so a 2 s clip is never reused as a 4 s one", async () => {
    concat.mockClear();
    const s = [0, 0.5, 1].map((t) => slice("B", t + 20));
    await latticeScene(s, questions, "m5", undefined, { write: false, contextQuestionIds: [motion], contextSlices: 4 });
    await latticeScene(s, questions, "m5", undefined, { write: false, contextQuestionIds: [motion], contextSlices: 8 });
    expect(concat).toHaveBeenCalledTimes(6);
    expect(new Set(concat.mock.calls.map(([, out]) => path.basename(out as string).split("-")[0])).size).toBe(2);
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
