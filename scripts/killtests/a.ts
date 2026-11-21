// OWNER: Dev 1. Kill test A: are Decision 1's probabilities trustworthy on video?
// Scores the grid of every perceived NVIDIA SDG-Warehouse near-miss scene (data/scenes/<id>/grid.jsonl)
// against its answer key (data/labels/<id>.truth.json, from lib/capture/sdgWarehouse.ts).
// Pass: calibration error <= 0.10, AUROC >= 0.85 on state questions, visibility >= 90% right.
// Fail: try 1 s slices and higher resolution; still failing -> switch to Needle.
// Usage: pnpm killtest a                 score scenes already perceived (no model calls)
//        pnpm killtest a --perceive 5    first perceive up to 5 unperceived scenes (model calls!)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GridRow } from "@/lib/types";
import { DATA_DIR } from "@/lib/config";
import { readSdgTruth } from "@/lib/capture/sdgWarehouse";
import { joinWithTruth, scoreKillTestA, KILL_TEST_A, type KillTestAResult } from "@/lib/perception/calibration";
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
  result: KillTestAResult;
}

export async function runKillTestA(opts: KillTestAOptions): Promise<KillTestARun> {
  const log = opts.log ?? (() => {});
  const labels = path.resolve(DATA_DIR, "labels");
  const ids = existsSync(labels)
    ? readdirSync(labels).filter((f) => f.startsWith("sdg_") && f.endsWith(".truth.json")).map((f) => f.replace(".truth.json", "")).sort()
    : [];
  const grid = (id: string) => path.resolve(DATA_DIR, "scenes", id, "grid.jsonl");

  let budget = opts.perceive ?? 0;
  for (const id of ids) {
    if (budget <= 0) break;
    if (existsSync(grid(id)) || !existsSync(path.resolve(DATA_DIR, "scenes", id, "manifest.json"))) continue;
    budget--;
    log(`perceiving ${id}...`);
    await perceiveScene(id, { presynced: true, questionSet: "sdg-nearmiss", onStep: (s, d) => log(`  ${s}: ${d}`) });
  }

  const scenes = ids.filter((id) => existsSync(grid(id)));
  const labeled = scenes.flatMap((id) => joinWithTruth(readGrid(grid(id)), readSdgTruth(path.join(labels, `${id}.truth.json`))));
  return { scenes, notPerceived: ids.filter((id) => !scenes.includes(id)), result: scoreKillTestA(labeled) };
}

const f3 = (x: number) => (Number.isNaN(x) ? "  n/a" : x.toFixed(3));

export function formatReport(run: KillTestARun): string {
  const r = run.result;
  const lines = [
    `Kill test A: ${r.pass ? "PASS" : "FAIL"}  (scenes scored: ${run.scenes.length}, not perceived: ${run.notPerceived.length})`,
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
  return lines.join("\n");
}

export async function main(): Promise<void> {
  const i = process.argv.indexOf("--perceive");
  const perceive = i >= 0 ? Number(process.argv[i + 1] ?? "0") : 0;
  if (!Number.isInteger(perceive) || perceive < 0) throw new Error("--perceive needs a whole number of scenes");
  const run = await runKillTestA({ perceive, log: (l) => console.log(l) });
  console.log(formatReport(run));
  const out = path.resolve("logs", "killtest-a.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ at: new Date().toISOString(), ...run }, null, 2) + "\n");
  console.log(`\nwrote ${out}`);
  if (!run.result.pass) process.exitCode = 1;
}
