// OWNER: Dev 4. Results table: every metric as a raw count with a 95% Wilson interval,
// false-contradiction rate first, split by natural vs planned occlusion.
// Usage: pnpm eval:report  (reads data/scenes + data/labels; prints the table)
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "@/lib/config";
import type { ClaimResult, GroundTruthItem, SceneManifest } from "@/lib/types";
import {
  type ClaimEval,
  type Rate,
  byOcclusion,
  claimAccuracy,
  falseClaimRecall,
  falseContradictionRate,
  wilson,
} from "./stats";

export interface MetricRow {
  metric: string;
  overall: Rate;
  natural: Rate;
  planned: Rate;
}

/** The metric rows, safety number first. Each split overall / natural / planned occlusion. */
export function computeMetrics(items: ClaimEval[]): MetricRow[] {
  const { natural, planned } = byOcclusion(items);
  const row = (metric: string, fn: (xs: ClaimEval[]) => Rate): MetricRow => ({
    metric,
    overall: fn(items),
    natural: fn(natural),
    planned: fn(planned),
  });
  return [
    row("False-contradiction rate", falseContradictionRate),
    row("Claim-label accuracy", claimAccuracy),
    row("False-claim recall", falseClaimRecall),
  ];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** One cell: "k/n  rate [lo-hi]", or a dash when there were no observations. */
function cell(r: Rate): string {
  if (r.total === 0) return "—";
  return `${r.count}/${r.total}  ${pct(r.rate)} [${pct(r.low)}–${pct(r.high)}]`;
}

export function formatTable(rows: MetricRow[]): string {
  const header = ["Metric", "Overall", "Natural", "Planned"];
  const body = rows.map((r) => [r.metric, cell(r.overall), cell(r.natural), cell(r.planned)]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i]!.length)),
  );
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i]!)).join("   ");
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

// ---------- loading predicted vs truth from disk ----------

export interface EvalInputs {
  items: ClaimEval[];
  /** Labeler agreement: disagreements become Ambiguous, so agreement = non-ambiguous / total. */
  agreement: Rate;
  scenes: number;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Join each scene's results.json (predicted) with its labels (truth) into ClaimEval[]. */
export async function loadEvalInputs(dataDir: string = DATA_DIR): Promise<EvalInputs> {
  const scenesDir = path.join(dataDir, "scenes");
  const labelsDir = path.join(dataDir, "labels");

  let sceneIds: string[] = [];
  try {
    const entries = await readdir(scenesDir, { withFileTypes: true });
    sceneIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    sceneIds = [];
  }

  const items: ClaimEval[] = [];
  let agree = 0;
  let labelled = 0;

  for (const sceneId of sceneIds) {
    const manifest = await readJson<SceneManifest | null>(
      path.join(scenesDir, sceneId, "manifest.json"),
      null,
    );
    const results = await readJson<ClaimResult[]>(
      path.join(scenesDir, sceneId, "results.json"),
      [],
    );
    const labels = await readJson<GroundTruthItem[]>(
      path.join(labelsDir, `${sceneId}.json`),
      [],
    );
    const truthByClaim = new Map(
      labels.filter((l) => l.claimId).map((l) => [l.claimId as string, l.label]),
    );
    const predictedByClaim = new Map(results.map((r) => [r.claimId, r.verdict]));

    for (const [claimId, truth] of truthByClaim) {
      labelled++;
      if (truth !== "Ambiguous") agree++;
      const predicted = predictedByClaim.get(claimId);
      if (!predicted) continue; // labelled but not yet scored
      items.push({
        sceneId,
        claimId,
        predicted,
        truth,
        plannedOcclusion: manifest?.plannedOcclusion ?? false,
      });
    }
  }

  return { items, agreement: wilson(agree, labelled), scenes: sceneIds.length };
}

export async function buildReport(dataDir: string = DATA_DIR): Promise<void> {
  const { items, agreement, scenes } = await loadEvalInputs(dataDir);
  if (items.length === 0) {
    console.log(
      `No scored claims found under ${path.join(dataDir, "scenes")} + ${path.join(dataDir, "labels")}.`,
    );
    console.log("Generate scenes + labels first, then re-run pnpm eval:report.");
    return;
  }
  console.log(`RASHOMON results — ${scenes} scene(s), ${items.length} scored claim(s)\n`);
  console.log(formatTable(computeMetrics(items)));
  console.log(`\nLabeler agreement: ${cell(agreement)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  buildReport().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
