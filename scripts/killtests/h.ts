// OWNER: Dev 3. Kill test H: is the Skeptic safe?
// 10 decided claims (5 right, 5 wrong). Pass: 0 right labels changed, 0 new Contradicted,
// >= 3 of 5 wrong labels downgraded. Fail: narrow when it runs; still failing -> ship the Investigator alone.
//
// Usage: pnpm killtest h            offline (default): a fixed clip-picking rule. "H offline: safety checks only".
//        pnpm killtest h --model    the real Skeptic turn via startAgent() (respects AGENT_MODE). Only the clip
//                                   check is faked. "H model (fake clips)". Spends tokens; respects assertBudget.
//
// Scene (deterministic, fixed seed; no Gemini in offline mode, no video in either mode):
// - One entity per claim, so claims never interfere. Each entity moves zone B -> C at its own time T.
// - The STILLS grid (initial evidence) is Dev 2's fakeGrid() over a truth in which, for the 5 wrong claims,
//   the entity went to D instead: a shared error every unoccluded camera sees the same way. Some cameras
//   are also occluded in the stills.
// - The CLIP grid (what the fake checkWindow() answers from) is fakeGrid() over the real truth, with its own
//   occlusion. In 3 of the 5 wrong claims only one included camera can see the truth in a clip.
// - Initial labels: Dev 2's real evidenceFor() + verdict(), with a stand-in audit of the strongest usable
//   view. Every claim must start decided and Skeptic-eligible (real explainEligibility), or the test aborts.
// - The Skeptic runs through the real startAgent() -> runAgent() -> bridge, menu, verdict(),
//   enforceDowngradeOnly(). The audit of a checked clip is a stand-in: the scores of that same fake clip.
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { assertBudget } from "@/lib/cost";
import { evidenceFor } from "@/lib/inference/evidence";
import { fakeGrid } from "@/lib/inference/fake-grid";
import { verdict } from "@/lib/inference/verdict";
import type { CheckWindowArgs } from "@/lib/perception/checkWindow";
import type {
  AgentStep,
  Audit,
  CameraId,
  Claim,
  ClaimResult,
  Event,
  Evidence,
  GridRow,
  Question,
  SceneManifest,
  Verdict,
} from "@/lib/types";
import { explainEligibility } from "@/lib/agent/eligibility";
import type { TurnInput, TurnOutput } from "@/lib/agent/loop";
import { startAgent, type StartAgentDeps } from "@/lib/agent/start";

export const SCENE_ID = "killtest-h";
const CAMERAS: CameraId[] = ["A", "B", "C"];
const SEED = 8;
const NOISE = 0.2;
const SPACING_S = 12;
const FIRST_T = 10;
const DURATION_S = FIRST_T + SPACING_S * 10;

type Kind = "right" | "wrong";
interface Case {
  id: string;
  kind: Kind;
  object: string;
  /** Zone the claim says the object was put in (truth is always C). */
  claimedZone: "C" | "D";
  /** Cameras occluded around the move in the stills (initial evidence). */
  stillsBlocked: CameraId[];
  /** Cameras occluded around the move in clips (what the Skeptic can check). */
  clipsBlocked: CameraId[];
  /** Expected initial label (checked; the test aborts if construction drifts). */
  initial: Verdict;
}

// Right: decided correctly. Wrong: decided wrongly because the stills show the shared error.
export const CASES: Case[] = [
  { id: "r1", kind: "right", object: "red mug", claimedZone: "D", stillsBlocked: [], clipsBlocked: [], initial: "Contradicted" },
  { id: "r2", kind: "right", object: "blue cup", claimedZone: "D", stillsBlocked: ["B", "C"], clipsBlocked: ["B", "C"], initial: "Contradicted" },
  { id: "r3", kind: "right", object: "green box", claimedZone: "D", stillsBlocked: ["A"], clipsBlocked: ["A"], initial: "Contradicted" },
  { id: "r4", kind: "right", object: "yellow ball", claimedZone: "C", stillsBlocked: ["B", "C"], clipsBlocked: ["B", "C"], initial: "Supported" },
  { id: "r5", kind: "right", object: "black phone", claimedZone: "C", stillsBlocked: ["A", "C"], clipsBlocked: ["A", "C"], initial: "Supported" },
  // w1: true claim, every camera's stills show the wrong move; every camera's clip shows the truth.
  { id: "w1", kind: "wrong", object: "white plate", claimedZone: "C", stillsBlocked: [], clipsBlocked: [], initial: "Contradicted" },
  // w2: true claim; only C is unoccluded in stills (wrong) and only C sees the truth in a clip.
  { id: "w2", kind: "wrong", object: "orange book", claimedZone: "C", stillsBlocked: ["A", "B"], clipsBlocked: ["A", "B"], initial: "Contradicted" },
  // w3: false claim (D); stills on B alone wrongly support it; only B sees the truth in a clip.
  { id: "w3", kind: "wrong", object: "purple bag", claimedZone: "D", stillsBlocked: ["A", "C"], clipsBlocked: ["A", "C"], initial: "Supported" },
  // w4: false claim (D); stills on A alone wrongly support it; every camera's clip shows the truth.
  { id: "w4", kind: "wrong", object: "silver key", claimedZone: "D", stillsBlocked: ["B", "C"], clipsBlocked: [], initial: "Supported" },
  // w5: true claim; only A is unoccluded in stills (wrong) and only A sees the truth in a clip.
  { id: "w5", kind: "wrong", object: "brown shoe", claimedZone: "C", stillsBlocked: ["B", "C"], clipsBlocked: ["B", "C"], initial: "Contradicted" },
];

const moveTime = (i: number) => FIRST_T + SPACING_S * i;
const entityId = (c: Case) => c.id;

export const QUESTIONS: Question[] = CASES.flatMap((c) =>
  (["B", "C", "D"] as const).map((zone) => ({
    id: `${c.id}:location:${zone}`,
    entityId: entityId(c),
    predicate: "location" as const,
    value: zone,
    text: `Is the ${c.object} in zone ${zone}?`,
  })),
);

const evt = (entity: string, from: string, to: string, t: number): Event => ({ entityId: entity, from, to, t, confidence: 1, cameras: [] });
/** What really happened: every object goes B -> C. */
const TRUTH: Event[] = CASES.flatMap((c, i) => [evt(entityId(c), "unknown", "B", 0), evt(entityId(c), "B", "C", moveTime(i))]);
/** What the stills show: for wrong cases, a shared error makes every unoccluded camera see B -> D. */
const STILLS_TRUTH: Event[] = CASES.flatMap((c, i) => [
  evt(entityId(c), "unknown", "B", 0),
  evt(entityId(c), "B", c.kind === "wrong" ? "D" : "C", moveTime(i)),
]);
const blocked = (pick: (c: Case) => CameraId[]) =>
  CASES.flatMap((c, i) => pick(c).map((camera) => ({ camera, window: [moveTime(i) - 3, moveTime(i) + 4] as [number, number] })));

export const CLAIMS: Claim[] = CASES.map((c, i) => ({
  id: c.id,
  sceneId: SCENE_ID,
  text: `Sam put the ${c.object} in zone ${c.claimedZone}`,
  actor: "Sam",
  object: c.object,
  action: "put",
  window: [moveTime(i) - 1, moveTime(i) + 2],
  timeIsPrecise: true,
}));

const MANIFEST: SceneManifest = {
  sceneId: SCENE_ID,
  split: "dev",
  room: "killtest",
  cameras: CAMERAS,
  excludedCameras: [],
  files: {},
  durationS: DURATION_S,
  createdAt: "2026-11-21T00:00:00.000Z",
  plannedOcclusion: true,
};

const grid = (truth: Event[], occluded: ReturnType<typeof blocked>): GridRow[] =>
  fakeGrid({ sceneId: SCENE_ID, cameras: CAMERAS, durationS: DURATION_S, truth, questions: QUESTIONS, noise: NOISE, sharedErrorRate: 0, occluded, seed: SEED });

/**
 * Only this claim's object's rows. evidenceFor() keeps only rows for the claimed question and its
 * alternatives (all of the claim's object), so the result is identical; it just skips re-indexing the
 * other nine objects' rows on every call.
 */
const rowsFor = (rows: GridRow[], claimId: string) => rows.filter((r) => r.questionId.startsWith(`${claimId}:`));

/** Stand-in for Decision 1 on the cited clip: the strongest usable view's own scores (null if none usable). */
function citedAudit(evidence: Evidence[]): Audit | null {
  const strength = (e: Evidence) => Math.max(e.supports ?? 0, e.contradicts ?? 0);
  const best = evidence.filter((e) => e.visible >= THRESHOLDS.USABLE).sort((a, b) => strength(b) - strength(a))[0];
  return best ? { supportScore: best.supports, contradictScore: best.contradicts, clipId: best.clipId } : null;
}

/** The deterministic scene: stills grid, clip grid, and every claim's initial (decided) result. */
export function buildScene() {
  const stillsRows = grid(STILLS_TRUTH, blocked((c) => c.stillsBlocked));
  const clipRows = grid(TRUTH, blocked((c) => c.clipsBlocked));
  const initial = new Map<string, ClaimResult>();
  for (const claim of CLAIMS) {
    const evidence = evidenceFor(claim, rowsFor(stillsRows, claim.id), QUESTIONS);
    const audit = citedAudit(evidence);
    const result: ClaimResult = { claimId: claim.id, verdict: verdict(evidence, claim, audit), evidence, audit, history: [] };
    const c = CASES.find((x) => x.id === claim.id)!;
    if (result.verdict !== c.initial) {
      throw new Error(`kill test H setup: ${claim.id} starts ${result.verdict}, expected ${c.initial}. The fake scene drifted.`);
    }
    const e = explainEligibility(result, claim);
    if (e.agent !== "skeptic") throw new Error(`kill test H setup: ${claim.id} is not Skeptic-eligible (${e.reason}).`);
    initial.set(claim.id, result);
  }
  return { stillsRows, clipRows, initial };
}

/** Fake Dev 1 checkWindow(): scores the requested camera/window from the clip grid (the hidden truth). */
function clipCheck(clipRows: GridRow[]) {
  return async (a: CheckWindowArgs): Promise<Evidence> => {
    const runs = evidenceFor({ ...a.claim, window: a.window }, rowsFor(clipRows, a.claim.id), QUESTIONS).filter(
      (e) => e.camera === a.camera,
    );
    const pick = runs.find((e) => e.visible >= THRESHOLDS.USABLE) ?? runs[0];
    const clipId = `clip:${SCENE_ID}:${a.camera}:${a.window[0]}-${a.window[1]}:${a.crop}`;
    if (!pick) return { camera: a.camera, window: a.window, visible: 0, supports: null, contradicts: null, clipId, source: a.source };
    return { ...pick, window: a.window, clipId, source: a.source };
  };
}

/**
 * The offline rule, the same for every claim and using only the menu: check the included cameras in order
 * of their best initial visibility (ties by camera id), skipping ones already clip-checked over the claim
 * window, each over the claim window (cut to CLIP_MAX_S). Stop when none is left.
 */
export function fixedRuleTurn({ menu }: TurnInput): Promise<TurnOutput> {
  const [w0, w1] = menu.claim.window;
  const window: [number, number] = [w0, Math.min(w1, w0 + LIMITS.CLIP_MAX_S)];
  const checked = (c: CameraId) => menu.alreadyChecked.some((k) => k.camera === c && k.window[0] < window[1] && window[0] < k.window[1]);
  const vis = (c: CameraId) => Math.max(0, ...menu.evidence.filter((e) => e.camera === c).map((e) => e.visible));
  const next = menu.includedCameras.filter((c) => !checked(c)).sort((a, b) => vis(b) - vis(a) || a.localeCompare(b))[0];
  const usage = { tokens: 0, costUsd: 0, latencyMs: 0 };
  if (!next) return Promise.resolve({ name: "stop", args: { reason: "Every included camera has been checked." }, ...usage });
  return Promise.resolve({
    name: "inspect_window",
    args: { camera_id: next, start_s: window[0], end_s: window[1], crop: "entity", reason: `Camera ${next} had the clearest view.` },
    ...usage,
  });
}

// ---------- run and report ----------

export type HMode = "offline" | "model";

export interface HRow {
  claimId: string;
  kind: Kind;
  initial: Verdict;
  final: Verdict;
  steps: string;
}

export interface HReport {
  mode: HMode;
  label: string;
  rightChanged: number;
  newContradicted: number;
  wrongDowngraded: number;
  wrongTotal: number;
  pass: boolean;
  rows: HRow[];
  tokens: number;
  costUsd: number;
}

const describeSteps = (steps: AgentStep[]) =>
  steps
    .map((s) =>
      s.action === "inspect_window" && "camera_id" in s.args
        ? `inspect ${s.args.camera_id}`
        : s.action === "rejected"
          ? "rejected"
          : s.implicitStop
            ? "stop(implicit)"
            : "stop",
    )
    .join(", ");

export async function runKillTestH(
  mode: HMode = "offline",
  /** Offline only: replaces the fixed rule (tests use it to show a worse rule fails). */
  turn: (input: TurnInput) => Promise<TurnOutput> = fixedRuleTurn,
): Promise<HReport> {
  const { clipRows, initial } = buildScene();
  const saved = new Map(initial);
  const logged: AgentStep[] = [];
  const rows: HRow[] = [];

  for (const claim of CLAIMS) {
    const c = CASES.find((x) => x.id === claim.id)!;
    const deps: StartAgentDeps = {
      loadManifest: async () => MANIFEST,
      loadResults: async () => [...saved.values()],
      saveResult: async (_s, r) => void saved.set(r.claimId, r),
      logStep: async (_s, step) => void logged.push(step),
      checkWindow: clipCheck(clipRows),
      audit: async (_claim, e) => ({ supportScore: e.supports, contradictScore: e.contradicts, clipId: e.clipId }),
      ...(mode === "offline"
        ? { turn, mode: "standin" as const, assertBudget: async () => {} }
        : { assertBudget: () => assertBudget() }), // model: startAgent picks AGENT_MODE's turn
    };
    const out = await startAgent("skeptic", claim, SCENE_ID, deps);
    if (!out.ran) throw new Error(`kill test H: the Skeptic refused ${claim.id}: ${out.reason}`);
    rows.push({ claimId: claim.id, kind: c.kind, initial: c.initial, final: out.run.result.verdict, steps: describeSteps(out.run.steps) });
  }

  const right = rows.filter((r) => r.kind === "right");
  const wrong = rows.filter((r) => r.kind === "wrong");
  const rightChanged = right.filter((r) => r.final !== r.initial).length;
  const newContradicted = rows.filter((r) => r.final === "Contradicted" && r.initial !== "Contradicted").length;
  const wrongDowngraded = wrong.filter((r) => r.final === "Insufficient").length;
  return {
    mode,
    label: mode === "offline" ? "H offline: safety checks only" : "H model (fake clips)",
    rightChanged,
    newContradicted,
    wrongDowngraded,
    wrongTotal: wrong.length,
    pass: rightChanged === 0 && newContradicted === 0 && wrongDowngraded >= 3,
    rows,
    tokens: logged.reduce((n, s) => n + s.tokens, 0),
    costUsd: logged.reduce((n, s) => n + s.costUsd, 0),
  };
}

export function formatReport(r: HReport): string {
  const pad = (s: string, n: number) => s.padEnd(n);
  const lines = [
    `${r.label}`,
    `right labels changed:    ${r.rightChanged} (must be 0)`,
    `new Contradicted:        ${r.newContradicted} (must be 0)`,
    `wrong labels downgraded: ${r.wrongDowngraded} of ${r.wrongTotal} (need >= 3)`,
    `${r.pass ? "PASS" : "FAIL"}`,
    "",
    `${pad("claim", 7)}${pad("kind", 7)}${pad("initial", 14)}${pad("final", 14)}steps`,
    ...r.rows.map((x) => `${pad(x.claimId, 7)}${pad(x.kind, 7)}${pad(x.initial, 14)}${pad(x.final, 14)}${x.steps}`),
  ];
  if (r.mode === "model") lines.push("", `tokens: ${r.tokens}  cost: $${r.costUsd.toFixed(6)}`);
  return lines.join("\n");
}

export async function main(): Promise<void> {
  const mode: HMode = process.argv.includes("--model") ? "model" : "offline";
  const report = await runKillTestH(mode);
  console.log(formatReport(report));
  if (!report.pass) process.exitCode = 1;
}
