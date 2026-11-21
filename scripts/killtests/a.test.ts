// OWNER: Dev 1.
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GridRow } from "@/lib/types";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-killa-"));
process.env.DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const { calibrationSource, formatReport, readGrid, runKillTestA } = await import("./a");

const yes = "yes";
function writeScene(id: string, rows: GridRow[] | null) {
  const cams = Object.fromEntries(
    ["A", "B", "C", "D"].map((c) => [c, { alias: `cam_${c}`, "worker:visible:yes": c === "D" ? "no" : yes, "forklift:visible:yes": yes }]),
  );
  const truth = {
    sceneId: id,
    runId: `r_${id}`,
    views: { A: "cam_A", B: "cam_B", C: "cam_C", D: "cam_D" },
    summary: { outcome: "contact" },
    slices: [0, 0.5].map((t) => ({
      t,
      answers: {
        "forklift:state:near_worker": t === 0 ? "no" : "yes",
        "forklift:state:touching_worker": "no",
        "forklift:state:moving": "yes",
        "worker:state:dodging": "unclear",
      },
      cameras: cams,
    })),
  };
  mkdirSync(path.join(dataDir, "labels"), { recursive: true });
  writeFileSync(path.join(dataDir, "labels", `${id}.truth.json`), JSON.stringify(truth));
  mkdirSync(path.join(dataDir, "scenes", id), { recursive: true });
  if (rows) writeFileSync(path.join(dataDir, "scenes", id, "grid.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

const row = (sceneId: string, camera: GridRow["camera"], t: number, questionId: string, pYes: number): GridRow => ({
  sceneId, camera, t, questionId, pYes, pVisible: 0.9,
});

describe("readGrid", () => {
  it("parses grid.jsonl rows and rejects malformed ones with the line number", () => {
    const f = path.join(dataDir, "g.jsonl");
    writeFileSync(f, `${JSON.stringify(row("s", "A", 0, "q", 0.5))}\n\n`);
    expect(readGrid(f)).toHaveLength(1);
    writeFileSync(f, `${JSON.stringify(row("s", "A", 0, "q", 0.5))}\n{"sceneId":"s"}\n`);
    expect(() => readGrid(f)).toThrow(/line 2/);
  });
});

describe("runKillTestA", () => {
  it("scores every perceived SDG scene against its answer key and lists the ones not perceived", async () => {
    writeScene("sdg_nm_1", [
      row("sdg_nm_1", "A", 0, "forklift:state:near_worker", 0.05),
      row("sdg_nm_1", "A", 0.5, "forklift:state:near_worker", 0.95),
      row("sdg_nm_1", "A", 0, "worker:visible:yes", 0.9),
      row("sdg_nm_1", "D", 0, "worker:visible:yes", 0.2),
      row("sdg_nm_1", "D", 0, "forklift:state:near_worker", 0.9), // worker hidden on D: not scored
    ]);
    writeScene("sdg_nm_2", null);
    const res = await runKillTestA({});
    expect(res.scenes).toEqual(["sdg_nm_1"]);
    expect(res.notPerceived).toEqual(["sdg_nm_2"]);
    expect(res.result.state.n).toBe(2);
    expect(res.result.state.auroc).toBe(1);
    expect(res.result.visible).toMatchObject({ n: 2, accuracy: 1 });
    expect(res.result.pass).toBe(true);
    const text = formatReport(res);
    expect(text).toMatch(/PASS/);
    expect(text).toMatch(/forklift:state:near_worker/);
    expect(text).toMatch(/not perceived: 1/);
    expect(text).toMatch(/Raw model answers/);
    expect(text).toMatch(/Calibrated/);
    expect(res.calibrated.state.n).toBe(2);
    expect(Object.keys(res.models)).toContain("forklift:state:near_worker");
  });

  it("scores the raw file when the grid was calibrated", async () => {
    writeScene("sdg_nm_3", [row("sdg_nm_3", "A", 0, "worker:visible:yes", 0.99)]);
    writeFileSync(path.join(dataDir, "scenes", "sdg_nm_3", "grid.raw.jsonl"), JSON.stringify(row("sdg_nm_3", "A", 0, "worker:visible:yes", 0.2)) + "\n");
    const res = await runKillTestA({});
    const v = res.result.perQuestion.find((q) => q.questionId === "worker:visible:yes")!;
    expect(v.accuracy).toBeLessThan(1); // the raw 0.2 was scored, not the calibrated 0.99
  });
});

describe("calibrationSource", () => {
  it("writes a TypeScript module with the fitted numbers only", () => {
    const src = calibrationSource({ "worker:state:dodging": { a: 2.34567, b: -0.1, n: 120 } }, ["s1", "s2"]);
    expect(src).toContain("GENERATED");
    expect(src).toContain('"worker:state:dodging": { a: 2.3457, b: -0.1, n: 120 }');
    expect(src).not.toMatch(/s1|truth/i);
  });
});
