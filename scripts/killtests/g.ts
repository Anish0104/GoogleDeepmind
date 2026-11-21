// OWNER: Dev 3. Kill test G: does the Investigator work?
// Pass: on undecided claims (occluded initial view, camera disagreement, genuinely unseeable), the Investigator
// picks a valid clip through the bridge, uses the returned evidence, stops or picks a second valid clip within the
// 2-check cap, resolves the recoverable claims, and introduces 0 false decisive labels on the unseeable claim.
//
// Usage: pnpm killtest g            offline (default): deterministic Investigator rule over the fake scene.
//        pnpm killtest g --model    real Investigator turn via startAgent() (respects AGENT_MODE).
//        pnpm killtest g --managed  forces AGENT_MODE="managed" (Gemini Managed Agent via Interactions API).
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
import { startAgent } from "@/lib/agent/start";

export const SCENE_ID = "killtest-g";
const CAMERAS: CameraId[] = ["A", "B", "C"];
const SEED = 7;
const NOISE = 0.1;
const SPACING_S = 12;
const FIRST_T = 10;

export type GMode = "offline" | "model" | "managed";

interface GCase {
  id: string;
  description: string;
  object: string;
  /** Real destination zone (truth). */
  truthZone: "C" | "D";
  /** Zone named in the claim. */
  claimedZone: "C" | "D";
  /** Cameras occluded in initial stills. */
  stillsBlocked: CameraId[];
  /** Cameras occluded in follow-up clips. */
  clipsBlocked: CameraId[];
  /** Expected final verdict when the Investigator checks available cameras. */
  expectedFinal: Verdict;
}

export const CASES: GCase[] = [
  {
    id: "g1",
    description: "planned occlusion in stills; follow-up clip settles the true move on check 1 -> early stop",
    object: "red mug",
    truthZone: "C",
    claimedZone: "C",
    stillsBlocked: ["A", "B", "C"],
    clipsBlocked: [],
    expectedFinal: "Supported",
  },
  {
    id: "g2",
    description: "false claim occluded in stills; camera A clip blocked, camera B clip catches B -> C on check 2",
    object: "blue box",
    truthZone: "C",
    claimedZone: "D",
    stillsBlocked: ["A", "B", "C"],
    clipsBlocked: ["A", "C"],
    expectedFinal: "Contradicted",
  },
  {
    id: "g3",
    description: "every camera blocked in both stills and clips; must stay Insufficient",
    object: "green cup",
    truthZone: "D",
    claimedZone: "C",
    stillsBlocked: ["A", "B", "C"],
    clipsBlocked: ["A", "B", "C"],
    expectedFinal: "Insufficient",
  },
];

const DURATION_S = FIRST_T + SPACING_S * CASES.length + 6;
const moveTime = (i: number) => FIRST_T + SPACING_S * i;

export const QUESTIONS: Question[] = CASES.flatMap((c) =>
  (["B", "C", "D"] as const).map((zone) => ({
    id: `${c.id}:location:${zone}`,
    entityId: c.id,
    predicate: "location" as const,
    value: zone,
    text: `Is the ${c.object} in zone ${zone}?`,
  })),
);

const evt = (entityId: string, from: string, to: string, t: number): Event => ({
  entityId,
  from,
  to,
  t,
  confidence: 1,
  cameras: [],
});

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
  room: "killtest-g",
  cameras: CAMERAS,
  excludedCameras: [],
  files: {},
  durationS: DURATION_S,
  createdAt: "2026-11-21T00:00:00.000Z",
  plannedOcclusion: true,
};

const rowsFor = (rows: GridRow[], claimId: string) => rows.filter((r) => r.questionId.startsWith(`${claimId}:`));

function citedAudit(evidence: Evidence[]): Audit | null {
  const strength = (e: Evidence) => Math.max(e.supports ?? 0, e.contradicts ?? 0);
  const best = evidence.filter((e) => e.visible >= THRESHOLDS.USABLE).sort((a, b) => strength(b) - strength(a))[0];
  return best ? { supportScore: best.supports, contradictScore: best.contradicts, clipId: best.clipId } : null;
}

/** Deterministic Investigator test scene: initial Insufficient results + clip grid. */
export function buildScene() {
  const truthEvents: Event[] = CASES.flatMap((c, i) => [
    evt(c.id, "unknown", "B", 0),
    evt(c.id, "B", c.truthZone, moveTime(i)),
  ]);

  const blocked = (pick: (c: GCase) => CameraId[]) =>
    CASES.flatMap((c, i) =>
      pick(c).map((camera) => ({ camera, window: [moveTime(i) - 3, moveTime(i) + 4] as [number, number] })),
    );

  const stillsRows = fakeGrid({
    sceneId: SCENE_ID,
    cameras: CAMERAS,
    durationS: DURATION_S,
    truth: truthEvents,
    questions: QUESTIONS,
    noise: NOISE,
    sharedErrorRate: 0,
    occluded: blocked((c) => c.stillsBlocked),
    seed: SEED,
  });

  const clipRows = fakeGrid({
    sceneId: SCENE_ID,
    cameras: CAMERAS,
    durationS: DURATION_S,
    truth: truthEvents,
    questions: QUESTIONS,
    noise: NOISE,
    sharedErrorRate: 0,
    occluded: blocked((c) => c.clipsBlocked),
    seed: SEED + 2,
  });

  const initial = new Map<string, ClaimResult>();
  for (const claim of CLAIMS) {
    const evidence = evidenceFor(claim, rowsFor(stillsRows, claim.id), QUESTIONS);
    const audit = citedAudit(evidence);
    const result: ClaimResult = {
      claimId: claim.id,
      verdict: verdict(evidence, claim, audit),
      evidence,
      audit,
      history: [],
    };
    if (result.verdict !== "Insufficient") {
      throw new Error(`kill test G setup: ${claim.id} started ${result.verdict}, expected Insufficient.`);
    }
    const elig = explainEligibility(result, claim);
    if (elig.agent !== "investigator") {
      throw new Error(`kill test G setup: ${claim.id} is not Investigator-eligible (${elig.reason}).`);
    }
    initial.set(claim.id, result);
  }
  return { stillsRows, clipRows, initial };
}

function clipCheck(clipRows: GridRow[]) {
  return async (a: CheckWindowArgs): Promise<Evidence> => {
    const runs = evidenceFor({ ...a.claim, window: a.window }, rowsFor(clipRows, a.claim.id), QUESTIONS).filter(
      (e) => e.camera === a.camera,
    );
    const clipId = `clip:${SCENE_ID}:${a.camera}:${a.window[0]}-${a.window[1]}:${a.crop}`;
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
}

/**
 * Deterministic Investigator rule: stop once the claim is settled (currentVerdict !== Insufficient);
 * otherwise pick an unchecked included camera over the claim window, preferring cameras not already occluded
 * or conflicted in initial stills.
 */
export function fixedInvestigatorTurn({ menu }: TurnInput): Promise<TurnOutput> {
  const usage = { tokens: 0, costUsd: 0, latencyMs: 0 };
  if (menu.currentVerdict !== "Insufficient") {
    return Promise.resolve({
      name: "stop",
      args: { reason: `Claim settled as ${menu.currentVerdict}.` },
      ...usage,
    });
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
    return Promise.resolve({ name: "stop", args: { reason: "No unchecked camera left." }, ...usage });
  }
  return Promise.resolve({
    name: "inspect_window",
    args: {
      camera_id: next,
      start_s: window[0],
      end_s: window[1],
      crop: "full",
      reason: `Check camera ${next} over the claim window to settle the claim.`,
    },
    ...usage,
  });
}

export interface GRow {
  claimId: string;
  initial: Verdict;
  final: Verdict;
  expectedFinal: Verdict;
  validChecks: number;
  rejectedChecks: number;
  stoppedCleanly: boolean;
  steps: string;
  mode: string;
  tokens: number;
  costUsd: number;
}

export interface GReport {
  label: string;
  mode: GMode;
  rows: GRow[];
  validClipsPicked: number;
  recoverableResolved: number;
  recoverableTotal: number;
  falseDecisiveOnUnseeable: number;
  allStoppedCleanly: boolean;
  tokens: number;
  costUsd: number;
  pass: boolean;
}

function describeSteps(steps: AgentStep[]): string {
  return steps
    .map((s) => (s.action === "inspect_window" && "camera_id" in s.args ? `inspect ${s.args.camera_id}` : s.action))
    .join(", ");
}

export async function runKillTestG(
  mode: GMode = "offline",
  customTurn?: (input: TurnInput) => Promise<TurnOutput>,
): Promise<GReport> {
  const { clipRows, initial } = buildScene();
  const check = clipCheck(clipRows);
  const rows: GRow[] = [];

  for (const c of CASES) {
    const claim = CLAIMS.find((x) => x.id === c.id)!;
    const startRes = structuredClone(initial.get(c.id)!);
    let saved: ClaimResult = startRes;
    const logged: AgentStep[] = [];

    const out = await startAgent("investigator", claim, SCENE_ID, {
      ...(mode === "offline"
        ? { turn: customTurn ?? fixedInvestigatorTurn, assertBudget: async () => {} }
        : customTurn
          ? { turn: customTurn, assertBudget }
          : { mode: mode === "managed" ? "managed" : undefined, assertBudget }),
      loadManifest: async () => MANIFEST,
      loadResults: async () => [startRes],
      buildMenu: async (agent, cl, res, man) => {
        const { buildMenu } = await import("@/lib/agent/menu");
        // Provide synthetic view descriptions in memory without touching disk.
        const base = await buildMenu(agent, cl, res, man).catch(() => ({
          agent,
          claim: { ...cl, window: [...cl.window] as [number, number] },
          currentVerdict: res.verdict,
          evidence: structuredClone(res.evidence),
          views: [],
          stillIds: {},
          includedCameras: [...man.cameras],
          allowedRangeS: [Math.max(0, cl.window[0] - LIMITS.AGENT_RANGE_PAD_S), Math.min(man.durationS, cl.window[1] + LIMITS.AGENT_RANGE_PAD_S)] as [number, number],
          alreadyChecked: res.evidence.filter((e) => e.source !== "initial").map((e) => ({ camera: e.camera, window: [...e.window] as [number, number] })),
          followUpsLeft: LIMITS.AGENT_MAX_CHECKS,
        }));
        return {
          ...base,
          views: [
            { camera: "A", text: "Camera A: front angle on zones B and C (blocked by rack in some clips)." },
            { camera: "B", text: "Camera B: side-on view of zones B, C and D." },
            { camera: "C", text: "Camera C: overhead unobstructed angle on zone C." },
          ],
        };
      },
      checkWindow: check,
      audit: async (_cl, cited) => ({
        supportScore: cited.supports,
        contradictScore: cited.contradicts,
        clipId: cited.clipId,
      }),
      verdict,
      logStep: async (_id, step) => {
        logged.push(step);
      },
      saveResult: async (_id, r) => {
        saved = r;
      },
    });

    if (!out.ran) throw new Error(`kill test G: Investigator refused ${c.id}: ${out.reason}`);
    const steps = out.run.steps;
    const validChecks = steps.filter((s) => s.action === "inspect_window").length;
    const rejectedChecks = steps.filter((s) => s.action === "rejected").length;
    const stoppedCleanly =
      (out.run.stopReason === "agent" || out.run.stopReason === "no_follow_ups") &&
      validChecks + rejectedChecks <= LIMITS.AGENT_MAX_CHECKS;
    const tokens = steps.reduce((n, s) => n + s.tokens, 0);
    const costUsd = steps.reduce((n, s) => n + s.costUsd, 0);

    rows.push({
      claimId: c.id,
      initial: startRes.verdict,
      final: saved.verdict,
      expectedFinal: c.expectedFinal,
      validChecks,
      rejectedChecks,
      stoppedCleanly,
      steps: describeSteps(steps),
      mode: out.run.mode ?? mode,
      tokens,
      costUsd,
    });
  }

  const validClipsPicked = rows.reduce((n, r) => n + r.validChecks, 0);
  const recoverable = rows.filter((r) => r.expectedFinal !== "Insufficient");
  const recoverableResolved = recoverable.filter((r) => r.final === r.expectedFinal).length;
  const unseeable = rows.filter((r) => r.expectedFinal === "Insufficient");
  const falseDecisiveOnUnseeable = unseeable.filter((r) => r.final !== "Insufficient").length;
  const allStoppedCleanly = rows.every((r) => r.stoppedCleanly && r.validChecks >= 1);
  const tokens = rows.reduce((n, r) => n + r.tokens, 0);
  const costUsd = rows.reduce((n, r) => n + r.costUsd, 0);

  const pass =
    allStoppedCleanly &&
    recoverableResolved >= 1 &&
    falseDecisiveOnUnseeable === 0 &&
    (mode !== "offline" || recoverableResolved === recoverable.length);

  const label =
    mode === "offline"
      ? "G offline: Investigator wiring & recovery check"
      : mode === "managed"
        ? "G managed: real Gemini Managed Agent Investigator"
        : `G model (${process.env.AGENT_MODE === "managed" ? "managed" : "standin"}): Investigator`;

  return {
    label,
    mode,
    rows,
    validClipsPicked,
    recoverableResolved,
    recoverableTotal: recoverable.length,
    falseDecisiveOnUnseeable,
    allStoppedCleanly,
    tokens,
    costUsd,
    pass,
  };
}

export function formatReport(r: GReport): string {
  const lines = [
    r.label,
    `  valid clips checked:          ${r.validClipsPicked} (at least 1 per claim, max ${LIMITS.AGENT_MAX_CHECKS})`,
    `  recoverable claims resolved:  ${r.recoverableResolved} of ${r.recoverableTotal} (need >= 1; all in offline)`,
    `  false labels on unseeable:    ${r.falseDecisiveOnUnseeable} (must be 0)`,
    `  clean stop within 2 checks:   ${r.allStoppedCleanly ? "yes" : "no"}`,
  ];
  if (r.mode !== "offline") {
    lines.push(`  tokens: ${r.tokens} · cost: $${r.costUsd.toFixed(4)}`);
  }
  lines.push(r.pass ? "PASS" : "FAIL", "");
  for (const row of r.rows) {
    lines.push(
      `${row.claimId}  ${row.initial} -> ${row.final} (expected ${row.expectedFinal})  [${row.mode}]  ${row.steps}`,
    );
  }
  return lines.join("\n") + "\n";
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const mode: GMode = argv.includes("--managed") ? "managed" : argv.includes("--model") ? "model" : "offline";
  const report = await runKillTestG(mode);
  process.stdout.write(formatReport(report));
  if (!report.pass) process.exitCode = 1;
}
