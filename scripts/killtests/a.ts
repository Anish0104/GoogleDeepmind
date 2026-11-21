// OWNER: Dev 1. Kill test A: are Decision 1's probabilities trustworthy on video?
// Scores the grid of every perceived NVIDIA SDG-Warehouse near-miss scene (data/scenes/<id>/grid.jsonl)
// against its answer key (data/labels/<id>.truth.json, from lib/capture/sdgWarehouse.ts).
// Pass: calibration error <= 0.10, AUROC >= 0.85 on state questions, visibility >= 90% right.
// Fail: try 1 s slices and higher resolution; still failing -> switch to Needle.
// Usage: pnpm killtest a                 score scenes already perceived (no model calls)
//        pnpm killtest a --perceive 5    first perceive up to 5 unperceived scenes (model calls!)
//        pnpm killtest a --fit           also write the fitted curves to lib/perception/gridCalibration.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GridRow } from "@/lib/types";
import { DATA_DIR } from "@/lib/config";
import { readSdgTruth } from "@/lib/capture/sdgWarehouse";
import {
  fitPerQuestion,
  joinWithTruth,
  leaveOneSceneOut,
  scoreKillTestA,
  KILL_TEST_A,
  type KillTestAResult,
  type PlattModel,
} from "@/lib/perception/calibration";
import { perceiveScene } from "@/lib/perception/perceive";

const GridRowSchema = z.object({
  sceneId: z.string(),
  camera: z.enum(["A", "B", "C", "D"]),
  t: z.number(),
  questionId: z.string(),
  pYes: z.number().min(0).max(1),
  pVisible: z.number().min(0).max(1),
});

export function readGrid(file: string): GridRow[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l, i) => [l, i] as const)
    .filter(([l]) => l.trim() !== "")
    .map(([l, i]) => {
      const r = GridRowSchema.safeParse(JSON.parse(l));
      if (!r.success) throw new Error(`${file} line ${i + 1}: ${r.error.message}`);
      return r.data;
    });
}

export interface KillTestAOptions {
  /** Perceive up to this many scenes that have no grid yet before scoring (spends model calls). */
  perceive?: number;
  log?: (line: string) => void;
}

export interface KillTestARun {
  scenes: string[];
  notPerceived: string[];
  /** The model's own answers (grid.raw.jsonl when the grid was calibrated). */
  result: KillTestAResult;
  /** Each scene calibrated with curves fitted on the other scenes: what to expect on new footage. */
  calibrated: KillTestAResult;
  /** Curves fitted on every scored scene, for lib/perception/gridCalibration.ts. */
  models: Record<string, PlattModel>;
}

export async function runKillTestA(opts: KillTestAOptions): Promise<KillTestARun> {
  const log = opts.log ?? (() => {});
  const labels = path.resolve(DATA_DIR, "labels");
  const ids = existsSync(labels)
    ? readdirSync(labels).filter((f) => f.startsWith("sdg_") && f.endsWith(".truth.json")).map((f) => f.replace(".truth.json", "")).sort()
    : [];
  const grid = (id: string) => path.resolve(DATA_DIR, "scenes", id, "grid.jsonl");
  /** Score the model's own answers: the raw file if the grid was calibrated. */
  const rawGrid = (id: string) => {
    const raw = path.resolve(DATA_DIR, "scenes", id, "grid.raw.jsonl");
    return existsSync(raw) ? raw : grid(id);
  };

  let budget = opts.perceive ?? 0;
  for (const id of ids) {
    if (budget <= 0) break;
    if (existsSync(grid(id)) || !existsSync(path.resolve(DATA_DIR, "scenes", id, "manifest.json"))) continue;
    budget--;
    log(`perceiving ${id}...`);
    await perceiveScene(id, { presynced: true, questionSet: "sdg-nearmiss", onStep: (s, d) => log(`  ${s}: ${d}`) });
  }

  const scenes = ids.filter((id) => existsSync(grid(id)));
  const labeled = scenes.flatMap((id) => joinWithTruth(readGrid(rawGrid(id)), readSdgTruth(path.join(labels, `${id}.truth.json`))));
  return {
    scenes,
    notPerceived: ids.filter((id) => !scenes.includes(id)),
    result: scoreKillTestA(labeled),
    calibrated: scoreKillTestA(leaveOneSceneOut(labeled)),
    models: fitPerQuestion(labeled),
  };
}

const f3 = (x: number) => (Number.isNaN(x) ? "  n/a" : x.toFixed(3));

function formatResult(title: string, r: KillTestAResult): string[] {
  return [
    `${title}: ${r.pass ? "PASS" : "FAIL"}`,
    `  state questions: n=${r.state.n}  ECE ${f3(r.state.ece)} (<= ${KILL_TEST_A.MAX_ECE})  AUROC ${f3(r.state.auroc)} (>= ${KILL_TEST_A.MIN_AUROC})  accuracy ${f3(r.state.accuracy)}`,
    `  visibility:      n=${r.visible.n}  accuracy ${f3(r.visible.accuracy)} (>= ${KILL_TEST_A.MIN_VISIBLE_ACCURACY})  ECE ${f3(r.visible.ece)}`,
    ...r.failures.map((f) => `  - ${f}`),
    "",
    "  per question                        n   yes    ECE  AUROC    acc",
    ...r.perQuestion.map(
      (q) => `  ${q.questionId.padEnd(32)} ${String(q.n).padStart(4)} ${String(q.positives).padStart(5)}  ${f3(q.ece)}  ${f3(q.auroc)}  ${f3(q.accuracy)}`,
    ),
    "",
    "  reliability (state)   n   mean p   hit rate",
    ...r.state.bins.map((b) => `  ${b.lo.toFixed(1)}-${b.hi.toFixed(1)}  ${String(b.n).padStart(8)}   ${b.meanP.toFixed(3)}    ${b.hitRate.toFixed(3)}`),
  ];
}

export function formatReport(run: KillTestARun): string {
  return [
    `Kill test A: ${run.calibrated.pass ? "PASS" : "FAIL"} after calibration (scenes scored: ${run.scenes.length}, not perceived: ${run.notPerceived.length})`,
    "",
    ...formatResult("Raw model answers", run.result),
    "",
    ...formatResult("Calibrated (each scene with curves fitted on the other scenes)", run.calibrated),
  ].join("\n");
}

/** lib/perception/gridCalibration.ts: the fitted curves, per question set. */
export function calibrationSource(models: Record<string, PlattModel>, scenes: string[]): string {
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  const body = Object.entries(models)
    .map(([id, m]) => `    ${JSON.stringify(id)}: { a: ${r(m.a)}, b: ${r(m.b)}, n: ${m.n} },`)
    .join("\n");
  return `// OWNER: Dev 1. GENERATED by \`pnpm killtest a --fit\` from ${scenes.length} SDG near-miss scenes; do not edit by hand.
// Per-question Platt curves p' = sigmoid(a * logit(p) + b) that correct the grid's underconfidence.
// Fitted numbers only: no labels, scenes or answer keys are in this file.
export const GRID_CALIBRATION: Record<string, Record<string, { a: number; b: number; n: number }>> = {
  "sdg-nearmiss": {
${body}
  },
};
`;
}

export async function main(): Promise<void> {
  const i = process.argv.indexOf("--perceive");
  const perceive = i >= 0 ? Number(process.argv[i + 1] ?? "0") : 0;
  if (!Number.isInteger(perceive) || perceive < 0) throw new Error("--perceive needs a whole number of scenes");
  const run = await runKillTestA({ perceive, log: (l) => console.log(l) });
  console.log(formatReport(run));
  if (process.argv.includes("--fit")) {
    const file = path.resolve("lib", "perception", "gridCalibration.ts");
    await writeFile(file, calibrationSource(run.models, run.scenes));
    console.log(`\nwrote ${file}`);
  }
  const out = path.resolve("logs", "killtest-a.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ at: new Date().toISOString(), ...run }, null, 2) + "\n");
  console.log(`\nwrote ${out}`);
  if (!run.calibrated.pass) process.exitCode = 1;
}
