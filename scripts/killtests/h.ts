// OWNER: Dev 3. Kill test H: is the Skeptic safe?
// 10 decided claims (5 right, 5 wrong). Pass: 0 right labels changed, 0 new Contradicted,
// >= 3 of 5 wrong labels downgraded. Fail: narrow when it runs; still failing -> ship the Investigator alone.
//
// Usage: pnpm killtest h            offline (default): a fixed clip-picking rule. "H offline: safety checks only".
//        pnpm killtest h --model    the real Skeptic turn via startAgent() (respects AGENT_MODE). Only the clip
//                                   check is faked. "H model (fake clips)". Spends tokens; respects assertBudget.
//        --save <file>              write every claim's agent calls (tool, camera, start, end, crop, reason) as JSON.
//        --replay <file>            replay saved calls with a scripted turn (no model); traces r2 step by step.
//        --trace <claimId>          print one claim step by step (calls, clips, evidence, audit, verdict).
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
import { readFile, writeFile } from "node:fs/promises";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { assertBudget } from "@/lib/cost";
import { evidenceFor } from "@/lib/inference/evidence";
import { fakeGrid } from "@/lib/inference/fake-grid";
import { enforceDowngradeOnly, verdict } from "@/lib/inference/verdict";
import { overlaps } from "@/lib/inference/window";
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

/**
 * Fake Dev 1 checkWindow(), answering from the clip grid (the hidden truth). It scores the WHOLE requested clip
 * the way the real checkWindow() asks Decision 1 about it (lib/perception/checkWindow.ts), and always answers
 * numbers, like the real one:
 * - visible: "clearly visible ... for most of its length" -> the visibility that holds for at least half of
 *   the clip's length (duration-weighted median of evidenceFor()'s runs).
 * - supports: "visibly shown happening" -> the best support of any part of the clip that can see, else 0.
 * - contradicts: "false if ... blocked or out of frame; true only if the clip visibly shows something
 *   different" -> the contradiction of a view that sees the whole clip, else 0.
 */
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

// ---------- saved calls (--save / --replay) ----------

/** One call the agent made, as saved by --save and replayed by --replay. */
export type SavedCall =
  | { tool: "inspect_window"; camera: CameraId; start: number; end: number; crop: "full" | "entity"; reason: string }
  | { tool: "stop"; reason: string; implicit?: true }
  /** A call that didn't parse: what the loop recorded (raw JSON, cut to 300 chars). */
  | { tool: "unparsed"; raw: string };

export interface SavedCalls {
  savedAt: string;
  mode: HMode;
  agentMode?: string;
  claims: Record<string, SavedCall[]>;
}

const SYSTEM_STOP = /^(Forced stop:|Stopped:)/;
const SYSTEM_REJECT = /^(model unavailable:|safety guard:)/;

/** The agent's own calls, from its steps. Stops and rejections the loop made by itself are left out. */
export function callsFromSteps(steps: AgentStep[]): SavedCall[] {
  const out: SavedCall[] = [];
  for (const s of steps) {
    if (s.action === "stop") {
      if (!s.implicitStop && SYSTEM_STOP.test(s.args.reason)) continue;
      out.push({ tool: "stop", reason: s.args.reason, ...(s.implicitStop ? { implicit: true as const } : {}) });
    } else if (s.action === "rejected" && SYSTEM_REJECT.test(s.rejectionReason ?? "")) {
      continue;
    } else if ("camera_id" in s.args) {
      const a = s.args;
      out.push({ tool: "inspect_window", camera: a.camera_id, start: a.start_s, end: a.end_s, crop: a.crop, reason: a.reason });
    } else {
      out.push({ tool: "unparsed", raw: s.args.reason });
    }
  }
  return out;
}

/** A scripted turn that replays saved calls per claim, in order; stops when a claim's calls run out. */
export function replayTurn(saved: SavedCalls): (input: TurnInput) => Promise<TurnOutput> {
  const next = new Map<string, number>();
  const usage = { tokens: 0, costUsd: 0, latencyMs: 0 };
  return async ({ menu }) => {
    const list = saved.claims[menu.claim.id] ?? [];
    const i = next.get(menu.claim.id) ?? 0;
    next.set(menu.claim.id, i + 1);
    const c = list[i];
    if (!c) return { name: "stop", args: { reason: "replay: no more saved calls" }, ...usage };
    if (c.tool === "inspect_window") {
      return { name: "inspect_window", args: { camera_id: c.camera, start_s: c.start, end_s: c.end, crop: c.crop, reason: c.reason }, ...usage };
    }
    if (c.tool === "stop") return { name: "stop", args: { reason: c.reason }, ...(c.implicit ? { implicitStop: true } : {}), ...usage };
    // Unparsed: resend the recorded tool name and raw args if they survive the 300-char cut; else an unknown tool.
    const m = /^Unparsed (\S+) call: ([\s\S]*)$/.exec(c.raw);
    let args: unknown = { raw: c.raw };
    try {
      if (m) args = JSON.parse(m[2]!);
    } catch {
      /* truncated: send the raw text */
    }
    return { name: m?.[1] ?? "(unparsed)", args, ...usage };
  };
}

// ---------- step-by-step trace of one claim ----------

const f3 = (x: number | null | undefined) => (x === null || x === undefined ? "null" : x.toFixed(3));
const ev = (e: Evidence) =>
  `${e.camera} ${e.window[0]}–${e.window[1]} s vis ${f3(e.visible)} sup ${f3(e.supports)} con ${f3(e.contradicts)} [${e.source}]`;
const au = (a: Audit | null) => (a ? `support ${f3(a.supportScore)} contradict ${f3(a.contradictScore)} (${a.clipId})` : "none");

/**
 * Diagnostic only: Dev 2's verdict() conditions applied to the same inputs, with the numbers, so the trace can
 * say which threshold was missed. The label printed is always verdict()'s own; a mismatch is flagged.
 */
function verdictConditions(evidence: Evidence[], claim: Claim, audit: Audit | null): string[] {
  const { USABLE, CLEAR, DECISIVE } = THRESHOLDS;
  const usable = evidence.filter((e) => e.visible >= USABLE && overlaps(e.window, claim.window));
  const max = (k: "supports" | "contradicts") => Math.max(-1, ...usable.map((e) => e[k] ?? -1));
  const sup = max("supports");
  const con = max("contradicts");
  const show = (x: number) => (x < 0 ? "none" : x.toFixed(3));
  const as = audit?.supportScore ?? null;
  const ac = audit?.contradictScore ?? null;
  const ok = (b: boolean) => (b ? "✓" : "✗");
  return [
    `usable views overlapping the claim (visible ≥ ${USABLE}): ${usable.map((e) => `${e.camera}[${e.source}]`).join(", ") || "none"}`,
    `Supported needs:    best support ≥ ${CLEAR} ${ok(sup >= CLEAR)} (${show(sup)}) · no contradiction ≥ ${CLEAR} ${ok(con < CLEAR)} (${show(con)}) · audit support ≥ ${CLEAR} ${ok(as !== null && as >= CLEAR)} (${f3(as)}) · audit contradict < ${CLEAR} ${ok(!(ac !== null && ac >= CLEAR))} (${f3(ac)})`,
    `Contradicted needs: best contradiction ≥ ${DECISIVE} ${ok(con >= DECISIVE)} (${show(con)}) · no support ≥ ${CLEAR} ${ok(sup < CLEAR)} (${show(sup)}) · audit contradict ≥ ${DECISIVE} ${ok(ac !== null && ac >= DECISIVE)} (${f3(ac)}) · audit support < ${CLEAR} ${ok(!(as !== null && as >= CLEAR))} (${f3(as)})${claim.timeIsPrecise ? "" : " · full coverage (vague time)"}`,
  ];
}

interface Tracer {
  lines: string[];
  wrap: (deps: StartAgentDeps, turn?: (i: TurnInput) => Promise<TurnOutput>) => StartAgentDeps;
}

function tracer(claim: Claim, initial: ClaimResult): Tracer {
  const lines: string[] = [];
  const say = (s: string) => lines.push(s);
  let audit: Audit | null = initial.audit;
  let n = 0;
  say(`Trace ${claim.id}: "${claim.text}", claim window ${claim.window[0]}–${claim.window[1]} s, starts ${initial.verdict}`);
  say(`  initial evidence (${initial.evidence.length}):`);
  for (const e of initial.evidence) say(`    ${ev(e)}`);
  say(`  initial audit: ${au(initial.audit)}`);
  for (const l of verdictConditions(initial.evidence, claim, initial.audit)) say(`  ${l}`);
  return {
    lines,
    wrap: (deps, turn) => ({
      ...deps,
      ...(turn
        ? {
            turn: async (input: TurnInput) => {
              const out = await turn(input);
              n++;
              say(`step ${n}: ${out.name} ${JSON.stringify(out.args)}${out.implicitStop ? " (implicit stop)" : ""}`);
              return out;
            },
          }
        : {}),
      checkWindow: async (a: CheckWindowArgs) => {
        const e = await deps.checkWindow!(a);
        say(`  fake checkWindow ${a.camera} ${a.window[0]}–${a.window[1]} s (${a.crop}) -> ${ev(e)}`);
        return e;
      },
      audit: async (c: Claim, e: Evidence) => {
        const a = await deps.audit!(c, e);
        say(`  audit of this clip: ${au(a)}`);
        return a;
      },
      verdict: (evidence: Evidence[], c: Claim, passed: Audit | null) => {
        const v = verdict(evidence, c, passed);
        const replaced = JSON.stringify(passed) !== JSON.stringify(audit);
        say(`  audit before: ${au(audit)}`);
        say(`  audit after:  ${au(passed)} ${replaced ? "(REPLACED by this clip's audit)" : "(kept: clip not usable)"}`);
        audit = passed;
        say(`  evidence passed to verdict() (${evidence.length}):`);
        for (const e of evidence) say(`    ${ev(e)}`);
        say(`  verdict() -> ${v}`);
        for (const l of verdictConditions(evidence, c, passed)) say(`    ${l}`);
        return v;
      },
      enforceDowngradeOnly: (prev: ClaimResult, next: Verdict, reason: string) => {
        const r = enforceDowngradeOnly(prev, next, reason);
        say(`  enforceDowngradeOnly: ${prev.verdict} -> ${next} ${r.verdict === next ? "ALLOWED" : `BLOCKED (kept ${r.verdict})`}`);
        return r;
      },
    }),
  };
}

// ---------- run and report ----------

export type HMode = "offline" | "model" | "replay";

/** A rejected step: the bridge's reason and, when the call parsed, the camera and window the agent sent. */
export interface HRejection {
  camera?: CameraId;
  start?: number;
  end?: number;
  /** For a call that didn't parse: what the agent sent, as the loop recorded it (raw JSON, cut to 300 chars). */
  sent?: string;
  reason: string;
}

export interface HRow {
  claimId: string;
  kind: Kind;
  initial: Verdict;
  final: Verdict;
  steps: string;
  /** Every rejected step, in order (each one used up a check). Report only; not part of pass/fail. */
  rejections: HRejection[];
  /** The agent's own calls, for --save. Report only. */
  calls: SavedCall[];
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
  /** Step-by-step trace of one claim (--trace), if asked for. */
  trace?: string[];
}

export interface HOptions {
  /** Claim id to trace step by step. */
  trace?: string;
  /** Report label override (e.g. the replay file). */
  label?: string;
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

const rejectionsOf = (steps: AgentStep[]): HRejection[] =>
  steps
    .filter((s) => s.action === "rejected")
    .map((s) => ({
      ...("camera_id" in s.args ? { camera: s.args.camera_id, start: s.args.start_s, end: s.args.end_s } : { sent: s.args.reason }),
      reason: s.rejectionReason ?? "(no reason recorded)",
    }));

const LABELS: Record<HMode, string> = {
  offline: "H offline: safety checks only",
  model: "H model (fake clips)",
  replay: "H replay (saved calls)",
};

/**
 * Runs kill test H. offline: `turn` (the fixed rule by default). replay: `turn` replays saved calls (no model).
 * model: the real Skeptic turn via startAgent() (AGENT_MODE), respecting assertBudget.
 */
export async function runKillTestH(
  mode: HMode = "offline",
  turn: (input: TurnInput) => Promise<TurnOutput> = fixedRuleTurn,
  opts: HOptions = {},
): Promise<HReport> {
  const { clipRows, initial } = buildScene();
  const saved = new Map(initial);
  const logged: AgentStep[] = [];
  const rows: HRow[] = [];
  let trace: string[] | undefined;

  for (const claim of CLAIMS) {
    const c = CASES.find((x) => x.id === claim.id)!;
    const scripted = mode !== "model";
    let deps: StartAgentDeps = {
      loadManifest: async () => MANIFEST,
      loadResults: async () => [...saved.values()],
      saveResult: async (_s, r) => void saved.set(r.claimId, r),
      logStep: async (_s, step) => void logged.push(step),
      checkWindow: clipCheck(clipRows),
      audit: async (_claim, e) => ({ supportScore: e.supports, contradictScore: e.contradicts, clipId: e.clipId }),
      ...(scripted
        ? { turn, mode: "standin" as const, assertBudget: async () => {} }
        : { assertBudget: () => assertBudget() }), // model: startAgent picks AGENT_MODE's turn
    };
    if (opts.trace === claim.id) {
      const t = tracer(claim, initial.get(claim.id)!);
      deps = t.wrap(deps, scripted ? turn : undefined);
      trace = t.lines;
    }
    const out = await startAgent("skeptic", claim, SCENE_ID, deps);
    if (!out.ran) throw new Error(`kill test H: the Skeptic refused ${claim.id}: ${out.reason}`);
    if (trace && opts.trace === claim.id) trace.push(`final: ${out.run.result.verdict} (${out.run.stopReason})`);
    rows.push({
      claimId: claim.id,
      kind: c.kind,
      initial: c.initial,
      final: out.run.result.verdict,
      steps: describeSteps(out.run.steps),
      rejections: rejectionsOf(out.run.steps),
      calls: callsFromSteps(out.run.steps),
    });
  }

  const right = rows.filter((r) => r.kind === "right");
  const wrong = rows.filter((r) => r.kind === "wrong");
  const rightChanged = right.filter((r) => r.final !== r.initial).length;
  const newContradicted = rows.filter((r) => r.final === "Contradicted" && r.initial !== "Contradicted").length;
  const wrongDowngraded = wrong.filter((r) => r.final === "Insufficient").length;
  return {
    mode,
    label: opts.label ?? LABELS[mode],
    rightChanged,
    newContradicted,
    wrongDowngraded,
    wrongTotal: wrong.length,
    pass: rightChanged === 0 && newContradicted === 0 && wrongDowngraded >= 3,
    rows,
    tokens: logged.reduce((n, s) => n + s.tokens, 0),
    costUsd: logged.reduce((n, s) => n + s.costUsd, 0),
    ...(trace ? { trace } : {}),
  };
}

/** The --save file: every claim's agent calls. */
export function savedCallsOf(r: HReport, agentMode?: string): SavedCalls {
  return {
    savedAt: new Date().toISOString(),
    mode: r.mode,
    ...(agentMode ? { agentMode } : {}),
    claims: Object.fromEntries(r.rows.map((x) => [x.claimId, x.calls])),
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
    ...r.rows.flatMap((x) => [
      `${pad(x.claimId, 7)}${pad(x.kind, 7)}${pad(x.initial, 14)}${pad(x.final, 14)}${x.steps}`,
      ...x.rejections.map(
        (j) => `       rejected: ${j.camera ? `camera ${j.camera} ${j.start}–${j.end} s` : `(unparsed call) ${j.sent}`}: ${j.reason}`,
      ),
    ]),
  ];
  if (r.mode === "model") lines.push("", `tokens: ${r.tokens}  cost: $${r.costUsd.toFixed(6)}`);
  if (r.trace) lines.push("", ...r.trace);
  return lines.join("\n");
}

const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/**
 * pnpm killtest h [--model | --replay <file>] [--save <file>] [--trace <claimId>]
 * --replay traces r2 unless --trace names another claim.
 */
export async function main(): Promise<void> {
  const replayFile = argValue("--replay");
  const saveFile = argValue("--save");
  const mode: HMode = replayFile ? "replay" : process.argv.includes("--model") ? "model" : "offline";
  const traceId = argValue("--trace") ?? (mode === "replay" ? "r2" : undefined);
  let turn: (input: TurnInput) => Promise<TurnOutput> = fixedRuleTurn;
  let label: string | undefined;
  if (replayFile) {
    const savedCalls = JSON.parse(await readFile(replayFile, "utf8")) as SavedCalls;
    turn = replayTurn(savedCalls);
    label = `H replay (${replayFile}; recorded in ${savedCalls.mode}${savedCalls.agentMode ? `/${savedCalls.agentMode}` : ""} mode)`;
  }
  const report = await runKillTestH(mode, turn, { trace: traceId, label });
  console.log(formatReport(report));
  if (saveFile) {
    await writeFile(saveFile, JSON.stringify(savedCallsOf(report, mode === "model" ? (process.env.AGENT_MODE ?? "standin") : undefined), null, 2) + "\n");
    console.log(`\nSaved every claim's agent calls to ${saveFile}`);
  }
  if (!report.pass) process.exitCode = 1;
}
