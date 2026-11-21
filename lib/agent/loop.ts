// OWNER: Dev 3. The loop both agents share: at most LIMITS.AGENT_MAX_CHECKS checks, then a forced stop.
// After each result: verdict() recomputes; the Skeptic's result also goes through enforceDowngradeOnly().
// Agents choose clips; only verdict() sets a label. Every dependency is injected so tests use fakes.
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { assertBudget, BudgetExceededError } from "@/lib/cost";
import { enforceDowngradeOnly, verdict } from "@/lib/inference/verdict";
import { checkWindow, type CheckWindowArgs } from "@/lib/perception/checkWindow";
import { saveResult } from "@/lib/store/scene";
import { audit } from "@/lib/truth/auditor";
import type {
  AgentMenu,
  AgentName,
  AgentStep,
  Audit,
  Claim,
  ClaimResult,
  Evidence,
  InspectWindowArgs,
  LabelChange,
  SceneManifest,
  Verdict,
} from "@/lib/types";
import { parseToolCall, validate } from "@/lib/agent/bridge";
import { withoutExcluded } from "@/lib/agent/eligibility";
import { logStep } from "@/lib/agent/log";
import { buildMenu, consume } from "@/lib/agent/menu";

/**
 * Why the loop ended: the agent called stop, follow-ups ran out, the budget hit, the model was still
 * unavailable after retries, or the safety guard caught a Skeptic result that was not a downgrade.
 */
export type StopReason = "agent" | "no_follow_ups" | "budget" | "model_unavailable" | "safety_guard";

export const SAFETY_GUARD_REASON = "safety guard: Skeptic result was not a downgrade";

export interface AgentRun {
  result: ClaimResult;
  steps: AgentStep[];
  stopReason: StopReason;
}

/** What the agent sees each turn: the allowlisted menu and its own earlier steps. Nothing else. */
export interface TurnInput {
  agent: AgentName;
  menu: AgentMenu;
  history: AgentStep[];
}

/** One raw (unparsed) tool call from the model, with its usage. */
export interface TurnOutput {
  name: string;
  args: unknown;
  tokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface AgentDeps {
  /** One agent turn: stand-in model call or managed agent. Returns the raw tool call. */
  turn: (input: TurnInput) => Promise<TurnOutput>;
  /** Inputs for buildMenu(): the claim's current result and the scene manifest. */
  start: { result: ClaimResult; manifest: SceneManifest };
  buildMenu: (agent: AgentName, claim: Claim, result: ClaimResult, manifest: SceneManifest) => Promise<AgentMenu>;
  checkWindow: (args: CheckWindowArgs) => Promise<Evidence>;
  audit: (claim: Claim, cited: Evidence) => Promise<Audit>;
  verdict: (evidence: Evidence[], claim: Claim, audit: Audit | null) => Verdict;
  enforceDowngradeOnly: (prev: ClaimResult, next: Verdict, reason: string) => ClaimResult;
  assertBudget: () => Promise<void>;
  logStep: (sceneId: string, step: AgentStep) => Promise<void>;
  saveResult: (sceneId: string, result: ClaimResult) => Promise<void>;
  now: () => Date;
}

/** Real implementations. verdict()/enforceDowngradeOnly() are Dev 2's; checkWindow()/audit() are stubs until merged. */
export const defaultDeps: Omit<AgentDeps, "turn" | "start"> = {
  buildMenu,
  checkWindow,
  audit,
  verdict,
  enforceDowngradeOnly,
  assertBudget: () => assertBudget(),
  logStep,
  saveResult,
  now: () => new Date(),
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Runs one agent on one claim until it stops, follow-ups run out (forced stop), the budget is hit,
 * or a turn fails. Every step is logged to agent-steps.jsonl and the final result is saved.
 * Never throws for a budget stop or a model error (turn failed after retries); rethrows other assertBudget() errors.
 */
export async function runAgent(
  agent: AgentName,
  claim: Claim,
  sceneId: string,
  deps: Pick<AgentDeps, "turn" | "start"> & Partial<AgentDeps>,
): Promise<AgentRun> {
  const d: AgentDeps = { ...defaultDeps, ...deps };
  let result = d.start.result;
  const built = await d.buildMenu(agent, claim, result, d.start.manifest);
  let menu: AgentMenu = { ...built, followUpsLeft: Math.min(built.followUpsLeft, LIMITS.AGENT_MAX_CHECKS) };
  const steps: AgentStep[] = [];
  let checks = 0;
  let stopReason: StopReason | undefined;

  const record = async (step: Omit<AgentStep, "agent" | "claimId" | "n">) => {
    const full: AgentStep = { agent, claimId: claim.id, n: steps.length + 1, ...step };
    steps.push(full);
    await d.logStep(sceneId, full);
  };
  const systemStop = (reason: string) => record({ action: "stop", args: { reason }, tokens: 0, costUsd: 0, latencyMs: 0 });

  while (stopReason === undefined) {
    if (menu.followUpsLeft <= 0 || checks >= LIMITS.AGENT_MAX_CHECKS) {
      stopReason = "no_follow_ups";
      await systemStop(`Forced stop: no follow-ups left (${checks} of ${LIMITS.AGENT_MAX_CHECKS} checks used).`);
      break;
    }

    try {
      await d.assertBudget();
    } catch (e) {
      if (!(e instanceof BudgetExceededError)) throw e;
      console.warn(`[agent] ${agent} on ${claim.id}: ${e.message}`);
      stopReason = "budget";
      await systemStop(`Stopped: ${e.message}`);
      break;
    }

    let out: TurnOutput;
    try {
      out = await d.turn({ agent, menu, history: [...steps] });
    } catch (e) {
      // Model errors never escape the loop: keep the current result, record why, stop, save below.
      const reason = `model unavailable: ${errMsg(e)}`;
      console.warn(`[agent] ${agent} on ${claim.id}: ${reason}`);
      stopReason = "model_unavailable";
      await record({ action: "rejected", args: { reason }, rejectionReason: reason, tokens: 0, costUsd: 0, latencyMs: 0 });
      break;
    }
    const usage = { tokens: out.tokens, costUsd: out.costUsd, latencyMs: out.latencyMs };
    const parsed = parseToolCall(out.name, out.args);

    // Malformed or unknown tool: uses a check, records no window.
    if (!parsed.ok) {
      checks++;
      menu = consume(menu, null, null);
      await record({
        action: "rejected",
        args: { reason: `Unparsed ${out.name} call: ${JSON.stringify(out.args)?.slice(0, 300) ?? "undefined"}` },
        rejectionReason: parsed.reason,
        droppedFields: parsed.droppedFields,
        ...usage,
      });
      continue;
    }
    const { call, droppedFields } = parsed;

    if (call.name === "stop") {
      stopReason = "agent";
      await record({ action: "stop", args: call.args, droppedFields, ...usage });
      break;
    }

    checks++;
    const check = validate(call.args, menu);
    if (!check.ok) {
      menu = consume(menu, call.args, null);
      await record({ action: "rejected", args: call.args, rejectionReason: check.reason, droppedFields, ...usage });
      continue;
    }

    let evidence: Evidence;
    let cited: Audit;
    try {
      evidence = await d.checkWindow({
        sceneId,
        camera: call.args.camera_id,
        window: [call.args.start_s, call.args.end_s],
        crop: call.args.crop,
        claim,
        source: agent,
      });
      cited = await d.audit(claim, evidence);
    } catch (e) {
      menu = consume(menu, call.args, null);
      await record({
        action: "rejected",
        args: call.args,
        rejectionReason: `Check failed: ${errMsg(e)}`,
        droppedFields,
        ...usage,
      });
      continue;
    }

    const applied = applyEvidence(agent, claim, result, evidence, cited, call.args, d);
    if (!applied.ok) {
      // Fail safe: keep the last consistent result (from before this step), record the breach, stop.
      console.error(`[agent] ${SAFETY_GUARD_REASON}: ${applied.detail}`);
      stopReason = "safety_guard";
      await record({
        action: "rejected",
        args: call.args,
        rejectionReason: SAFETY_GUARD_REASON,
        result: evidence,
        droppedFields,
        ...usage,
      });
      break;
    }
    result = applied.result;
    menu = { ...consume(menu, call.args, evidence), currentVerdict: result.verdict };
    await record({ action: "inspect_window", args: call.args, result: evidence, droppedFields, ...usage });
  }

  await d.saveResult(sceneId, result);
  return { result, steps, stopReason };
}

type Applied = { ok: true; result: ClaimResult } | { ok: false; detail: string };

/**
 * Adds the evidence, recomputes the label with verdict(), and records any attempted change.
 * The audit is replaced only when the new clip is usable (visible >= THRESHOLDS.USABLE).
 * Investigator: the new label applies and the loop writes the LabelChange.
 * Skeptic: enforceDowngradeOnly()'s ClaimResult is taken as is, including the history entry it writes
 * (blocked or not); the loop adds no second entry. If it ever returns anything but the old label or
 * Insufficient, returns ok: false so the loop can stop without saving it.
 */
function applyEvidence(
  agent: AgentName,
  claim: Claim,
  prev: ClaimResult,
  evidence: Evidence,
  cited: Audit,
  args: InspectWindowArgs,
  d: AgentDeps,
): Applied {
  // The new clip's audit replaces the old one only if the clip was usable: a blocked clip still adds its
  // evidence but must not wipe out an audit from a clip that actually saw something.
  const audit = evidence.visible >= THRESHOLDS.USABLE ? cited : prev.audit;
  const withEvidence: ClaimResult = { ...prev, evidence: [...prev.evidence, evidence], audit };
  // Excluded cameras never count toward a label, even if their evidence is stored in the result.
  const next = d.verdict(withoutExcluded(withEvidence.evidence, d.start.manifest.excludedCameras), claim, audit);
  if (next === prev.verdict) return { ok: true, result: withEvidence };

  const reason = `${args.reason} (clip ${evidence.clipId})`;
  if (agent === "skeptic") {
    const guarded = d.enforceDowngradeOnly(withEvidence, next, reason);
    // Invariant check, not a label decision: the Skeptic may only keep the label or downgrade to Insufficient.
    if (guarded.verdict !== prev.verdict && guarded.verdict !== "Insufficient") {
      return {
        ok: false,
        detail: `enforceDowngradeOnly() returned ${guarded.verdict} for ${prev.verdict} -> ${next} on claim ${claim.id}.`,
      };
    }
    return { ok: true, result: guarded };
  }

  const change: LabelChange = { from: prev.verdict, to: next, by: agent, reason, at: d.now().toISOString() };
  return { ok: true, result: { ...withEvidence, verdict: next, history: [...prev.history, change] } };
}
