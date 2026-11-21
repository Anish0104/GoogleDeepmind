// OWNER: Dev 4. The board's replay clock schedule. One clock T runs from 0 to `end`:
// 0..foot is the footage pass, foot..end is the agent phase. Saved scenes carry no
// timestamps for labels or agent steps, so this places them on the clock from the data:
// a claim's first label lands just after its window closes, agent steps are spread evenly
// over the agent phase in file order, and a later label change lands on the step that
// caused it. Presentation only: labels still come from results.json (set by verdict()).
import type {
  AgentName,
  AgentStep,
  CameraId,
  Claim,
  ClaimResult,
  InspectWindowArgs,
  StopArgs,
  Verdict,
} from "@/lib/types";
import { winTxt } from "@/components/canvas/math";
import { AGENT_COLOR } from "@/components/verdictStyle";

/** Seconds the agent phase occupies on the replay clock. */
export const AGENT_PHASE_S = 13;

export interface TimedStep {
  index: number;
  at: number;
  step: AgentStep;
  /** One-line action: "inspect CAM C 15–19s (full)", "rejected CAM B 13–16s" or "stop". */
  line: string;
  reason: string;
  /** This step ended an attempt that enforceDowngradeOnly() blocked. */
  blocked: boolean;
  camera?: CameraId;
  window?: [number, number];
  crop?: InspectWindowArgs["crop"];
}

export interface ClaimNote {
  at: number;
  text: string;
  color: string;
}

export interface ReplayTimeline {
  foot: number;
  end: number;
  steps: TimedStep[];
  /** Per claim: [time, label] in order. The label shown at T is the last one with time ≤ T. */
  verdicts: Record<string, [number, Verdict][]>;
  notes: Record<string, ClaimNote>;
}

export function isInspectArgs(args: InspectWindowArgs | StopArgs): args is InspectWindowArgs {
  return "camera_id" in args;
}

/** The trace line for one step. */
export function stepLine(step: AgentStep): string {
  if (isInspectArgs(step.args)) {
    const w: [number, number] = [step.args.start_s, step.args.end_s];
    if (step.action === "inspect_window") return `inspect CAM ${step.args.camera_id} ${winTxt(w)} (${step.args.crop})`;
    if (step.action === "rejected") return `rejected CAM ${step.args.camera_id} ${winTxt(w)}`;
  }
  return "stop";
}

/** The reason shown under a step: the bridge's rejection reason wins for rejected calls. */
export function stepReason(step: AgentStep): string {
  if (step.action === "rejected") return step.rejectionReason ?? step.args.reason;
  return step.args.reason;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildTimeline(
  claims: Claim[],
  results: ClaimResult[],
  agentSteps: AgentStep[],
  durationS: number,
): ReplayTimeline {
  const lastWindow = claims.reduce((m, c) => Math.max(m, c.window[1]), 0);
  const foot = durationS > 0 ? durationS : Math.max(1, lastWindow);
  const end = foot + AGENT_PHASE_S;

  // Agent steps: evenly spread from foot+1 to end-2, in file order.
  const n = agentSteps.length;
  const span = end - foot - 3;
  const ats = agentSteps.map((_, i) => round1(foot + 1 + (n > 1 ? (i * span) / (n - 1) : 0)));

  const lastStepAt = (claimId: string, agent: AgentName): number | undefined => {
    let at: number | undefined;
    agentSteps.forEach((s, i) => {
      if (s.claimId === claimId && s.agent === agent) at = ats[i];
    });
    return at;
  };
  const firstStep = (claimId: string): { at: number; agent: AgentName } | undefined => {
    const i = agentSteps.findIndex((s) => s.claimId === claimId);
    return i < 0 ? undefined : { at: ats[i]!, agent: agentSteps[i]!.agent };
  };

  const blockedStepIdx = new Set<number>();
  const verdicts: Record<string, [number, Verdict][]> = {};
  const notes: Record<string, ClaimNote> = {};
  const resultBy = new Map(results.map((r) => [r.claimId, r]));

  for (const claim of claims) {
    const result = resultBy.get(claim.id);
    if (!result) continue;
    const firstAt = claim.window[1] >= foot ? round1(foot + 0.2) : claim.window[1] + 0.5;
    const list: [number, Verdict][] = [];
    let note: ClaimNote | undefined;

    for (const h of result.history) {
      if (h.by === "initial") {
        list.push([firstAt, h.to]);
        continue;
      }
      const at = lastStepAt(claim.id, h.by) ?? end - 2;
      if (h.blocked) {
        const i = agentSteps.reduce((acc, s, k) => (s.claimId === claim.id && s.agent === h.by ? k : acc), -1);
        if (i >= 0) blockedStepIdx.add(i);
        note = { at, text: `${h.by} blocked`, color: "#FF5A47" };
      } else {
        list.push([at, h.to]);
        if (!note || note.color !== "#FF5A47") {
          note = {
            at,
            text: h.by === "skeptic" ? "downgraded by skeptic" : "changed after investigator",
            color: AGENT_COLOR[h.by],
          };
        }
      }
    }
    // No history at all: show the final label once the window closes.
    if (list.length === 0) list.push([firstAt, result.verdict]);
    list.sort((a, b) => a[0] - b[0]);
    verdicts[claim.id] = list;

    if (!note) {
      const first = firstStep(claim.id);
      if (first) note = { at: first.at, text: `${first.agent} checked`, color: AGENT_COLOR[first.agent] };
    }
    if (note) notes[claim.id] = note;
  }

  const steps: TimedStep[] = agentSteps.map((step, index) => {
    const t: TimedStep = {
      index,
      at: ats[index]!,
      step,
      line: stepLine(step),
      reason: stepReason(step),
      blocked: blockedStepIdx.has(index),
    };
    if (isInspectArgs(step.args)) {
      t.camera = step.args.camera_id;
      t.window = [step.args.start_s, step.args.end_s];
      t.crop = step.args.crop;
    }
    return t;
  });

  return { foot, end, steps, verdicts, notes };
}

/** The label a claim shows at clock time T, or null while it is still being read. */
export function verdictAt(tl: ReplayTimeline, claimId: string, T: number): Verdict | null {
  let v: Verdict | null = null;
  for (const [at, x] of tl.verdicts[claimId] ?? []) if (T >= at) v = x;
  return v;
}

/** Steps that have happened by T. */
export function stepsShown(tl: ReplayTimeline, T: number): TimedStep[] {
  return tl.steps.filter((s) => T >= s.at);
}

/** The step currently inspecting a camera window at T, if the latest step is an inspect. */
export function inspectAt(tl: ReplayTimeline, T: number): TimedStep | null {
  const shown = stepsShown(tl, T);
  const cur = shown[shown.length - 1];
  return cur && cur.step.action === "inspect_window" && cur.camera && cur.window ? cur : null;
}

/** Agent spend by T: the sum of costUsd for steps that have happened. */
export function spentAt(tl: ReplayTimeline, T: number): number {
  return stepsShown(tl, T).reduce((a, s) => a + s.step.costUsd, 0);
}

/** The claim note visible at T, if any. */
export function noteAt(tl: ReplayTimeline, claimId: string, T: number): ClaimNote | null {
  const n = tl.notes[claimId];
  return n && T >= n.at ? n : null;
}
