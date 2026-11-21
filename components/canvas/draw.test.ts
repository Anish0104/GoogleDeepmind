// OWNER: Dev 4. Smoke tests for the canvas renderers against a recording fake context.
import { describe, expect, it } from "vitest";
import { loadScene } from "@/components/loadScene";
import { fakeCtx } from "./fakeCtx";
import { drawCam, wbox } from "./drawCam";
import { GRID_GROUP_H, drawGrid, gridQuestions, sliceWidth } from "./drawGrid";
import { HERO_EVENTS, drawBraid, drawConvergence, drawField, drawHero, makeHeroState } from "./drawHero";
import { SYNC_OFFSETS, drawSync } from "./drawSync";
import { mkCam, proj } from "./math";

const input = { mx: 0, my: 0, cx: 200, cy: 200, scrollY: 0 };

describe("wbox", () => {
  it("strokes a box in view and skips one behind the camera", () => {
    const c = mkCam([0, 0, 10], [0, 0, 0]);
    const P = (p: [number, number, number]) => proj(c, p, 100, 100);
    const a = fakeCtx();
    wbox(a.ctx, P, [-1, -1, -1], [1, 1, 1]);
    expect(a.calls).toContain("stroke");
    const b = fakeCtx();
    wbox(b.ctx, P, [-1, -1, 20], [1, 1, 21]);
    expect(b.calls).not.toContain("stroke");
  });
});

describe("drawCam", () => {
  it("renders every camera, excluded or highlighted, at any time", () => {
    for (const id of ["A", "B", "C", "D"] as const) {
      for (const t of [0, 5, 11, 17, 22]) {
        const f = fakeCtx();
        drawCam(f.ctx, 640, 360, { id, t, off: id === "D", time: 1, highlight: id === "C" ? "#B79CFF" : null });
        expect(f.calls).toContain("fillText");
      }
    }
  });
});

describe("hero", () => {
  it("builds the mat cloud and 320 dust points", () => {
    const st = makeHeroState(() => 0.5);
    expect(st.dust).toHaveLength(320);
    expect(st.pts.some((p) => p[3] === 1)).toBe(true);
    expect(st.pts.some((p) => p[3] === 0.3)).toBe(true);
  });

  it("cycles three events covering all three labels", () => {
    expect(new Set(HERO_EVENTS.map((e) => e.v))).toEqual(new Set(["Supported", "Contradicted", "Insufficient"]));
  });

  it("draws each variant", () => {
    const st = makeHeroState();
    for (const fn of [
      (c: CanvasRenderingContext2D) => drawConvergence(c, 1400, 800, 3, st, input),
      (c: CanvasRenderingContext2D) => drawBraid(c, 1400, 800, 3, input),
      (c: CanvasRenderingContext2D) => drawField(c, 400, 300, 3, input),
      (c: CanvasRenderingContext2D) => drawHero(c, 600, 800, 9.5, "Convergence", st, input),
      (c: CanvasRenderingContext2D) => drawHero(c, 600, 800, 9.5, "Braid", st, input),
      (c: CanvasRenderingContext2D) => drawHero(c, 600, 800, 9.5, "Field", st, input),
    ]) {
      const f = fakeCtx();
      fn(f.ctx);
      expect(f.calls.length).toBeGreaterThan(10);
    }
  });
});

describe("evidence grid", () => {
  it("finds the sampling width and every question", async () => {
    const s = await loadScene("fixtures/replay/demo-001");
    expect(sliceWidth(s.grid)).toBe(4);
    expect(sliceWidth([])).toBe(0.5);
    expect(gridQuestions(s.grid, s.questions).map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(gridQuestions([{ ...s.grid[0]!, questionId: "qx" }], []).map((q) => q.id)).toEqual(["qx"]);
    expect(GRID_GROUP_H).toBeGreaterThan(40);
  });

  it("draws cells for the demo grid and a note for an empty one", async () => {
    const s = await loadScene("fixtures/replay/demo-001");
    const f = fakeCtx();
    drawGrid(f.ctx, 800, 150, {
      grid: s.grid,
      questions: s.questions,
      cameras: s.manifest.cameras,
      excluded: ["D"],
      claims: s.claims,
      foot: 22,
      T: 10,
    });
    expect(f.calls.filter((c) => c === "fillRect").length).toBeGreaterThan(20);
    const e = fakeCtx();
    drawGrid(e.ctx, 400, 150, { grid: [], questions: [], cameras: [], excluded: [], claims: [], foot: 22, T: 0 });
    expect(e.calls).toEqual(["clearRect", "fillText"]);
  });
});

describe("drawSync", () => {
  it("draws the four waveforms before, during and after sync", () => {
    expect(SYNC_OFFSETS.A).toBe(0);
    for (const [p, syncing] of [[0, false], [0.5, true], [1, false]] as const) {
      const f = fakeCtx();
      drawSync(f.ctx, 600, 240, p, syncing, 1);
      expect(f.calls.filter((c) => c === "stroke").length).toBeGreaterThanOrEqual(4);
    }
  });
});
