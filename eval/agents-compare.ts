// OWNER: Dev 3. Same cases, same 2-check budget.
// Investigator: off / fixed "next window" rule / stand-in / managed agent. Skeptic: off / on.
//
// Evaluates all configured (investigatorMode x skepticMode) cells over identical initial ClaimResults and clips,
// reporting raw counts with 95% Wilson intervals (eval/stats.ts):
// - Overall false-contradiction rate (safety metric, always first) and claim-label accuracy
// - Investigator: undecided claims resolved correctly; wrong decisive labels introduced
// - Skeptic: false contradictions & false supports removed (downgraded); correct labels wrongly downgraded
// - Tokens, USD and clip checks used per cell
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { DATA_DIR, LIMITS, THRESHOLDS } from "@/lib/config";
import { assertBudget } from "@/lib/cost";
import {
  claimAccuracy,
  falseContradictionRate,
  wilson,
  type ClaimEval,
  type Rate,
  type TruthLabel,
} from "@/eval/stats";
import { loadEvalInputs } from "@/eval/report";
import { resolveSplit } from "@/eval/run";
import { explainEligibility } from "@/lib/agent/eligibility";
import type { TurnInput, TurnOutput } from "@/lib/agent/loop";
import { startAgent } from "@/lib/agent/start";
import { enforceDowngradeOnly, verdict } from "@/lib/inference/verdict";
import type { CheckWindowArgs } from "@/lib/perception/checkWindow";
import type {
  AgentStep,
  Audit,
  CameraId,
  Claim,
  ClaimResult,
  Evidence,
  SceneManifest,
  Verdict,
} from "@/lib/types";
import { buildScene as buildKillG, CASES as G_CASES, CLAIMS as G_CLAIMS, QUESTIONS as G_QUESTIONS } from "@/scripts/killtests/g";
import { buildScene as buildKillH, CASES as H_CASES, CLAIMS as H_CLAIMS, QUESTIONS as H_QUESTIONS } from "@/scripts/killtests/h";
import { evidenceFor } from "@/lib/inference/evidence";

export type InvestigatorSetting = "off" | "fixed" | "standin" | "managed";
export type SkepticSetting = "off" | "on";

export interface ComparisonCase {
  caseId: string;
  sceneId: string;
  claim: Claim;
  manifest: SceneManifest;
  initial: ClaimResult;
  truth: Exclude<TruthLabel, "Ambiguous">;
  checkWindow: (args: CheckWindowArgs) => Promise<Evidence>;
  audit?: (claim: Claim, cited: Evidence) => Promise<Audit>;
}

export interface ComparisonCell {
  investigator: InvestigatorSetting;
  skeptic: SkepticSetting;
  falseContradiction: Rate;
  accuracy: Rate;
  /** Undecided initial claims resolved to their ground-truth label. */
  undecidedResolvedRight: Rate;
  /** Undecided initial claims given a wrong decisive (Supported/Contradicted) label. */
  wrongDecisiveIntroduced: Rate;
  /** Initially wrong decided claims (false Contradicted or false Supported) downgraded to Insufficient. */
  wrongDecidedRemoved: Rate;
  /** Initially right decided claims wrongly downgraded to Insufficient. */
  rightDecidedDowngraded: Rate;
  checksUsed: number;
  tokens: number;
  costUsd: number;
  predictions: { caseId: string; before: Verdict; after: Verdict; truth: TruthLabel }[];
}

export interface AgentComparisonReport {
  generatedAt: string;
  split: string;
  casesCount: number;
  cells: ComparisonCell[];
}

export interface RunComparisonOptions {
  investigators?: InvestigatorSetting[];
  skeptics?: SkepticSetting[];
  /** Optional injected turn for standin/managed in offline tests. */
  modelTurn?: (mode: "standin" | "managed") => ((input: TurnInput) => Promise<TurnOutput>) | undefined;
  assertBudget?: () => Promise<void>;
  now?: () => Date;
  split?: string;
}

/**
 * Fixed "next window" baseline rule at the same 2-check budget:
 * picks the next unchecked included camera (ordered by initial visibility, ties alphabetically) over the
 * claim window clamped to CLIP_MAX_S; Investigator stops early once a decisive label is reached.
 */
export function fixedNextWindowTurn({ agent, menu }: TurnInput): Promise<TurnOutput> {
  const usage = { tokens: 0, costUsd: 0, latencyMs: 0 };
  if (agent === "investigator" && menu.currentVerdict !== "Insufficient") {
    return Promise.resolve({ name: "stop", args: { reason: "Claim already settled." }, ...usage });
  }
  if (agent === "skeptic" && menu.currentVerdict === "Insufficient") {
    return Promise.resolve({ name: "stop", args: { reason: "Claim downgraded to Insufficient." }, ...usage });
  }
  const [w0, w1] = menu.claim.window;
  const window: [number, number] = [w0, Math.min(w1, w0 + LIMITS.CLIP_MAX_S)];
  const checked = (c: CameraId) =>
    menu.alreadyChecked.some((k) => k.camera === c && k.window[0] < window[1] && window[0] < k.window[1]);
  const vis = (c: CameraId) => Math.max(0, ...menu.evidence.filter((e) => e.camera === c).map((e) => e.visible));
  const next = menu.includedCameras
    .filter((c) => !checked(c))
    .sort((a, b) => vis(b) - vis(a) || a.localeCompare(b))[0];
  if (!next) {
    return Promise.resolve({ name: "stop", args: { reason: "All included cameras checked." }, ...usage });
  }
  return Promise.resolve({
    name: "inspect_window",
    args: {
      camera_id: next,
      start_s: window[0],
      end_s: window[1],
      crop: "full",
      reason: `Fixed next-window rule: check camera ${next}.`,
    },
    ...usage,
  });
}

const defaultAudit = async (_claim: Claim, cited: Evidence): Promise<Audit> => ({
  supportScore: cited.supports,
  contradictScore: cited.contradicts,
  clipId: cited.clipId,
});

async function runOneCase(
  c: ComparisonCase,
  investigator: InvestigatorSetting,
  skeptic: SkepticSetting,
  opts: RunComparisonOptions,
): Promise<{ after: Verdict; checks: number; tokens: number; costUsd: number }> {
  const elig = explainEligibility(c.initial, c.claim);
  if (!elig.agent) {
    return { after: c.initial.verdict, checks: 0, tokens: 0, costUsd: 0 };
  }
  if (elig.agent === "investigator" && investigator === "off") {
    return { after: c.initial.verdict, checks: 0, tokens: 0, costUsd: 0 };
  }
  if (elig.agent === "skeptic" && skeptic === "off") {
    return { after: c.initial.verdict, checks: 0, tokens: 0, costUsd: 0 };
  }

  // When Skeptic runs with Investigator="off" or "fixed", use the fixed rule unless Investigator is standin/managed.
  const turnSetting: "fixed" | "standin" | "managed" =
    elig.agent === "investigator"
      ? (investigator as "fixed" | "standin" | "managed")
      : investigator === "standin" || investigator === "managed"
        ? investigator
        : "fixed";

  let saved: ClaimResult = structuredClone(c.initial);
  const steps: AgentStep[] = [];
  const customModelTurn = turnSetting === "fixed" ? undefined : opts.modelTurn?.(turnSetting);
  const modeAndTurn =
    turnSetting === "fixed"
      ? { turn: fixedNextWindowTurn, mode: "standin" as const }
      : customModelTurn
        ? { turn: customModelTurn, mode: turnSetting }
        : { mode: turnSetting };

  const out = await startAgent(elig.agent, c.claim, c.sceneId, {
    ...modeAndTurn,
    assertBudget: turnSetting === "fixed" ? async () => {} : (opts.assertBudget ?? assertBudget),
    loadManifest: async () => c.manifest,
    loadResults: async () => [structuredClone(c.initial)],
    checkWindow: c.checkWindow,
    audit: c.audit ?? defaultAudit,
    verdict,
    enforceDowngradeOnly,
    logStep: async (_id, s) => {
      steps.push(s);
    },
    saveResult: async (_id, r) => {
      saved = r;
    },
  });

  if (!out.ran) return { after: c.initial.verdict, checks: 0, tokens: 0, costUsd: 0 };
  const checks = out.run.steps.filter((s) => s.action === "inspect_window" || s.action === "rejected").length;
  const tokens = out.run.steps.reduce((n, s) => n + s.tokens, 0);
  const costUsd = out.run.steps.reduce((n, s) => n + s.costUsd, 0);
  return { after: saved.verdict, checks, tokens, costUsd };
}

/** Runs every (Investigator x Skeptic) setting over the exact same ComparisonCase[] at the 2-check budget. */
export async function runAgentComparison(
  cases: ComparisonCase[],
  opts: RunComparisonOptions = {},
): Promise<AgentComparisonReport> {
  const investigators = opts.investigators ?? ["off", "fixed", "standin"];
  const skeptics = opts.skeptics ?? ["off", "on"];
  const cells: ComparisonCell[] = [];

  for (const investigator of investigators) {
    for (const skeptic of skeptics) {
      let checksUsed = 0;
      let tokens = 0;
      let costUsd = 0;
      const predictions: ComparisonCell["predictions"] = [];
      const evalItems: ClaimEval[] = [];

      for (const c of cases) {
        const r = await runOneCase(c, investigator, skeptic, opts);
        checksUsed += r.checks;
        tokens += r.tokens;
        costUsd += r.costUsd;
        predictions.push({ caseId: c.caseId, before: c.initial.verdict, after: r.after, truth: c.truth });
        evalItems.push({
          sceneId: c.sceneId,
          claimId: c.claim.id,
          predicted: r.after,
          truth: c.truth,
          plannedOcclusion: c.manifest.plannedOcclusion,
        });
      }

      const undecided = predictions.filter((p) => p.before === "Insufficient");
      const decidedWrong = predictions.filter((p) => p.before !== "Insufficient" && p.before !== p.truth);
      const decidedRight = predictions.filter((p) => p.before !== "Insufficient" && p.before === p.truth);

      cells.push({
        investigator,
        skeptic,
        falseContradiction: falseContradictionRate(evalItems),
        accuracy: claimAccuracy(evalItems),
        undecidedResolvedRight: wilson(
          undecided.filter((p) => p.after !== "Insufficient" && p.after === p.truth).length,
          undecided.filter((p) => p.truth !== "Insufficient").length,
        ),
        wrongDecisiveIntroduced: wilson(
          undecided.filter((p) => p.after !== "Insufficient" && p.after !== p.truth).length,
          undecided.length,
        ),
        wrongDecidedRemoved: wilson(
          decidedWrong.filter((p) => p.after === "Insufficient").length,
          decidedWrong.length,
        ),
        rightDecidedDowngraded: wilson(
          decidedRight.filter((p) => p.after !== p.before).length,
          decidedRight.length,
        ),
        checksUsed,
        tokens,
        costUsd,
        predictions,
      });
    }
  }

  return {
    generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
    split: opts.split ?? "dev",
    casesCount: cases.length,
    cells,
  };
}

/** Deterministic offline benchmark combining Kill Test G (3 undecided cases) + Kill Test H (10 decided cases). */
export function buildSyntheticComparisonCases(): ComparisonCase[] {
  const g = buildKillG();
  const h = buildKillH();
  const mkClipCheck = (clipRows: ReturnType<typeof buildKillG>["clipRows"], questions: typeof G_QUESTIONS, sceneId: string) =>
    async (a: CheckWindowArgs): Promise<Evidence> => {
      const runs = evidenceFor(
        { ...a.claim, window: a.window },
        clipRows.filter((r) => r.questionId.startsWith(`${a.claim.id}:`)),
        questions,
      ).filter((e) => e.camera === a.camera);
      const clipId = `clip:${sceneId}:${a.camera}:${a.window[0]}-${a.window[1]}:${a.crop}`;
      const len = (e: Evidence) => Math.max(0, Math.min(e.window[1], a.window[1]) - Math.max(e.window[0], a.window[0]));
      const total = runs.reduce((n, e) => n + len(e), 0);
      let visible = 0;
      let seen = 0;
      for (const e of [...runs].sort((x, y) => y.visible - x.visible)) {
        seen += len(e);
        if (seen >= total / 2 - 1e-9) {
          visible = e.visible;
          break;
        }
      }
      const usable = runs.filter((e) => e.visible >= THRESHOLDS.USABLE);
      const supports = Math.max(0, ...usable.map((e) => e.supports ?? 0));
      const whole = usable.find((e) => e.window[0] <= a.window[0] + 1e-9 && e.window[1] >= a.window[1] - 1e-9);
      const contradicts = whole?.contradicts ?? 0;
      return { camera: a.camera, window: a.window, visible, supports, contradicts, clipId, source: a.source };
    };

  const gManifest: SceneManifest = {
    sceneId: "killtest-g",
    split: "dev",
    room: "killtest-g",
    cameras: ["A", "B", "C"],
    excludedCameras: [],
    files: {},
    durationS: 60,
    createdAt: "2026-11-21T00:00:00.000Z",
    plannedOcclusion: true,
  };
  const hManifest: SceneManifest = {
    sceneId: "killtest-h",
    split: "dev",
    room: "killtest",
    cameras: ["A", "B", "C"],
    excludedCameras: [],
    files: {},
    durationS: 140,
    createdAt: "2026-11-21T00:00:00.000Z",
    plannedOcclusion: true,
  };

  const gCheck = mkClipCheck(g.clipRows, G_QUESTIONS, "killtest-g");
  const hCheck = mkClipCheck(h.clipRows, H_QUESTIONS, "killtest-h");

  const fromG: ComparisonCase[] = G_CASES.map((c) => ({
    caseId: `g:${c.id}`,
    sceneId: "killtest-g",
    claim: G_CLAIMS.find((x) => x.id === c.id)!,
    manifest: gManifest,
    initial: g.initial.get(c.id)!,
    truth: c.expectedFinal,
    checkWindow: gCheck,
  }));

  const fromH: ComparisonCase[] = H_CASES.map((c) => {
    const init = h.initial.get(c.id)!;
    // Right cases: initial label is truth. Wrong cases: truth is Supported when claimedZone==="C", else Contradicted.
    const truth: Exclude<TruthLabel, "Ambiguous"> =
      c.kind === "right" ? init.verdict : c.claimedZone === "C" ? "Supported" : "Contradicted";
    return {
      caseId: `h:${c.id}`,
      sceneId: "killtest-h",
      claim: H_CLAIMS.find((x) => x.id === c.id)!,
      manifest: hManifest,
      initial: init,
      truth,
      checkWindow: hCheck,
    };
  });

  return [...fromG, ...fromH];
}

const fmtRate = (r: Rate) =>
  r.total === 0
    ? "—"
    : `${r.count}/${r.total} (${(r.rate * 100).toFixed(0)}% [${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)}%])`;

export function formatComparisonMarkdown(report: AgentComparisonReport): string {
  const lines = [
    `# Agent comparison (${report.split})`,
    "",
    `Generated ${report.generatedAt} · ${report.casesCount} claim(s) · max ${LIMITS.AGENT_MAX_CHECKS} checks/agent`,
    "",
    "| Investigator | Skeptic | False-contradiction rate | Claim accuracy | Undecided resolved right | Wrong decisive added | Wrong decided removed | Right decided downgraded | Checks | Tokens | Cost |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...report.cells.map(
      (c) =>
        `| ${c.investigator} | ${c.skeptic} | ${fmtRate(c.falseContradiction)} | ${fmtRate(c.accuracy)} | ${fmtRate(c.undecidedResolvedRight)} | ${fmtRate(c.wrongDecisiveIntroduced)} | ${fmtRate(c.wrongDecidedRemoved)} | ${fmtRate(c.rightDecidedDowngraded)} | ${c.checksUsed} | ${c.tokens} | $${c.costUsd.toFixed(4)} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

/** Loads real split scenes that have claims.json, initial results.json and merged ground truth from eval/report.ts. */
async function loadSplitCases(split: "dev" | "heldout", dataDir: string): Promise<ComparisonCase[]> {
  const [{ checkWindow }, { audit }, scenes, evalInputs] = await Promise.all([
    import("@/lib/perception/checkWindow"),
    import("@/lib/truth/auditor"),
    resolveSplit(split, dataDir),
    loadEvalInputs(dataDir),
  ]);
  const truthByKey = new Map(
    evalInputs.items
      .filter((i): i is ClaimEval & { truth: Exclude<TruthLabel, "Ambiguous"> } => i.truth !== "Ambiguous")
      .map((i) => [`${i.sceneId}::${i.claimId}`, i.truth]),
  );

  const out: ComparisonCase[] = [];
  for (const s of scenes) {
    try {
      const [manifest, claims, results] = await Promise.all([
        readFile(path.join(s.dir, "manifest.json"), "utf8").then((t) => JSON.parse(t) as SceneManifest),
        readFile(path.join(s.dir, "claims.json"), "utf8").then((t) => JSON.parse(t) as Claim[]),
        readFile(path.join(s.dir, "results.json"), "utf8").then((t) => JSON.parse(t) as ClaimResult[]),
      ]);
      const resById = new Map(results.map((r) => [r.claimId, r]));
      for (const cl of claims) {
        const init = resById.get(cl.id);
        const truth = truthByKey.get(`${s.sceneId}::${cl.id}`);
        if (!init || !truth) continue;
        out.push({
          caseId: `${s.sceneId}:${cl.id}`,
          sceneId: s.sceneId,
          claim: cl,
          manifest,
          initial: init,
          truth,
          checkWindow,
          audit,
        });
      }
    } catch {
      /* skip incomplete scene */
    }
  }
  return out;
}

export interface CompareAgentsCliOptions {
  dataDir?: string;
  offline?: boolean;
  includeManaged?: boolean;
}

export async function compareAgents(
  split: "dev" | "heldout",
  opts: CompareAgentsCliOptions = {},
): Promise<AgentComparisonReport> {
  const dataDir = opts.dataDir ?? DATA_DIR;
  let cases = opts.offline ? [] : await loadSplitCases(split, dataDir);
  let splitLabel: string = split;
  if (cases.length === 0) {
    cases = buildSyntheticComparisonCases();
    splitLabel = opts.offline ? `${split} (offline synthetic)` : `${split} (synthetic fallback: no labelled split scenes yet)`;
  }
  const investigators: InvestigatorSetting[] = opts.includeManaged
    ? ["off", "fixed", "standin", "managed"]
    : opts.offline
      ? ["off", "fixed"]
      : ["off", "fixed", "standin"];

  const report = await runAgentComparison(cases, { investigators, skeptics: ["off", "on"], split: splitLabel });
  const outDir = path.resolve(dataDir, "eval", "results");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `agents-compare-${split}.json`), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(outDir, `agents-compare-${split}.md`), formatComparisonMarkdown(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const args = process.argv.slice(2);
  const splitIdx = args.indexOf("--split");
  const split = (splitIdx >= 0 && args[splitIdx + 1] === "heldout" ? "heldout" : "dev") as "dev" | "heldout";
  const report = await compareAgents(split, {
    offline: args.includes("--offline"),
    includeManaged: args.includes("--include-managed"),
  });
  process.stdout.write(formatComparisonMarkdown(report));
}
