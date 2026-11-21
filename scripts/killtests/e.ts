// OWNER: Dev 1. Kill test E: fast enough live? 4 cameras x 30 slices answered in parallel.
// Pass: every slice answered in under 10 s, with no rate-limit errors and no failed calls.
// Uses an already-sliced scene (default warehouse_nearmiss_001: 45 slices per camera) and asks its
// questions on the 0.5 s slices only (one call per slice, no context clips). Nothing is written.
// Usage: pnpm killtest e [--scene <id>] [--concurrency 40]   (makes 120 model calls)
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Question } from "@/lib/types";
import type { Slice } from "@/lib/capture/slice";

export const KILL_TEST_E = { CAMERAS: 4, SLICES_PER_CAMERA: 30, MAX_MS: 10_000, DEFAULT_CONCURRENCY: 40 } as const;

export interface SpeedRun {
  wallMs: number;
  expected: number;
  answered: number;
  rateLimited: number;
  failures: number;
}

export function judgeSpeed(r: SpeedRun, maxMs: number = KILL_TEST_E.MAX_MS): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  if (r.wallMs > maxMs) failures.push(`took ${(r.wallMs / 1000).toFixed(1)} s > ${maxMs / 1000} s`);
  if (r.answered < r.expected) failures.push(`answered ${r.answered} of ${r.expected} slices`);
  if (r.rateLimited > 0) failures.push(`${r.rateLimited} rate-limit errors`);
  if (r.failures > 0) failures.push(`${r.failures} failed calls`);
  return { pass: failures.length === 0, failures };
}

/** The first `perCamera` slices of the first `cameras` cameras (by camera letter). */
export function pickSlices(slices: Slice[], cameras: number, perCamera: number): Slice[] {
  const cams = [...new Set(slices.map((s) => s.camera))].sort().slice(0, cameras);
  if (cams.length < cameras) throw new Error(`kill test E needs ${cameras} cameras; scene has ${cams.length}`);
  return cams.flatMap((c) => {
    const list = slices.filter((s) => s.camera === c).sort((a, b) => a.t - b.t);
    if (list.length < perCamera) throw new Error(`camera ${c} has ${list.length} slices; kill test E needs ${perCamera} slices`);
    return list.slice(0, perCamera);
  });
}

const SliceSchema = z.object({ camera: z.enum(["A", "B", "C", "D"]), t: z.number(), durationS: z.number(), path: z.string(), stillPath: z.string() });
const QuestionSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  predicate: z.enum(["location", "heldBy", "state", "visible"]),
  value: z.string(),
  text: z.string(),
});

export interface KillTestERun extends SpeedRun {
  sceneId: string;
  pass: boolean;
  failureReasons: string[];
}

export async function runKillTestE(o: { sceneId: string; slicesPerCamera?: number }): Promise<KillTestERun> {
  // Imported here so main() can set MAX_CONCURRENT_CALLS before the client reads it.
  const { scenePath } = await import("@/lib/store/scene");
  const { latticeScene } = await import("@/lib/perception/lattice");
  const { clientStats } = await import("@/lib/gemini/client");

  const slices = z.array(SliceSchema).parse(JSON.parse(readFileSync(scenePath(o.sceneId, "slices.json"), "utf8"))) as Slice[];
  const questions = z.array(QuestionSchema).parse(JSON.parse(readFileSync(scenePath(o.sceneId, "questions.json"), "utf8"))) as Question[];
  const picked = pickSlices(slices, KILL_TEST_E.CAMERAS, o.slicesPerCamera ?? KILL_TEST_E.SLICES_PER_CAMERA);

  const before = clientStats();
  const answeredSlices = new Set<string>();
  const t0 = performance.now();
  await latticeScene(picked, questions, o.sceneId, (rows) => answeredSlices.add(`${rows[0]!.camera}@${rows[0]!.t}`), { write: false });
  const wallMs = performance.now() - t0;
  const after = clientStats();

  const run: SpeedRun = {
    wallMs,
    expected: picked.length,
    answered: answeredSlices.size,
    rateLimited: after.rateLimited - before.rateLimited,
    failures: after.failures - before.failures,
  };
  const j = judgeSpeed(run);
  return { sceneId: o.sceneId, ...run, pass: j.pass, failureReasons: j.failures };
}

export async function main(): Promise<void> {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  process.env.MAX_CONCURRENT_CALLS = arg("--concurrency") ?? String(KILL_TEST_E.DEFAULT_CONCURRENCY);
  const sceneId = arg("--scene") ?? "warehouse_nearmiss_001";
  const r = await runKillTestE({ sceneId });
  console.log(
    `Kill test E: ${r.pass ? "PASS" : "FAIL"}  scene ${sceneId}, concurrency ${process.env.MAX_CONCURRENT_CALLS}\n` +
      `  ${r.answered}/${r.expected} slices answered in ${(r.wallMs / 1000).toFixed(2)} s (limit ${KILL_TEST_E.MAX_MS / 1000} s); ` +
      `rate-limited ${r.rateLimited}, failed ${r.failures}` +
      r.failureReasons.map((f) => `\n  - ${f}`).join(""),
  );
  if (!r.pass) process.exitCode = 1;
}
