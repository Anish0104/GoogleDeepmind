// OWNER: Dev 3. Shared entry point for investigate() and challenge(): load the claim's current result and the
// manifest from the store, check eligibility, pick the turn function and run the loop.
// Mode: AGENT_MODE=managed|standin (default standin; managed only when AGENT_MODE=managed). If managed is
// model_unavailable on its first turn and AGENT_FALLBACK=standin, the run is repeated with the stand-in and
// labelled "standin-fallback", its steps numbered on from the managed step. The mode that actually ran is on
// the run and on every step, never hidden.
// Every reason not to run comes back as { ran: false, reason }, never as a thrown error.
import { loadManifest, loadResults, NotFoundError } from "@/lib/store/scene";
import type { AgentMode, AgentName, Claim, ClaimResult, SceneManifest } from "@/lib/types";
import { newSession } from "@/lib/agent/environment";
import { explainEligibility, withoutExcluded } from "@/lib/agent/eligibility";
import { createGenaiModel } from "@/lib/agent/genai-turn";
import { runAgent, type AgentDeps, type AgentRun, type TurnInput, type TurnOutput } from "@/lib/agent/loop";
import { createManagedTurn, type ManagedTurnOptions } from "@/lib/agent/managed-turn";
import { standinTurnFn, type StandinModel } from "@/lib/agent/standin";

export type AgentOutcome = { ran: true; run: AgentRun } | { ran: false; reason: string };

export interface StartAgentDeps extends Partial<Omit<AgentDeps, "start" | "mode">> {
  /** "managed": Gemini Managed Agent. "standin": ordinary function-calling turn. Default: managed only if AGENT_MODE=managed. */
  mode?: "managed" | "standin";
  /** "standin": rerun with the stand-in if managed fails on its first turn. Default: AGENT_FALLBACK, else none. */
  fallback?: "standin" | "none";
  /** Stand-in model; defaults to createGenaiModel(). Ignored when turn is given. */
  model?: StandinModel;
  /** Options for the managed turn (tests inject a fake client). A fresh session is always created per run. */
  managedOptions?: Omit<ManagedTurnOptions, "session">;
  loadManifest?: (sceneId: string) => Promise<SceneManifest>;
  loadResults?: (sceneId: string) => Promise<ClaimResult[]>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const label = (agent: AgentName) => (agent === "investigator" ? "investigator" : "skeptic");

/** Runs `agent` on `claim` if it is eligible. Returns a refusal reason instead of throwing for expected cases. */
export async function startAgent(
  agent: AgentName,
  claim: Claim,
  sceneId: string,
  deps: StartAgentDeps = {},
): Promise<AgentOutcome> {
  const refuse = (reason: string): AgentOutcome => ({ ran: false, reason });
  const {
    mode = process.env.AGENT_MODE === "managed" ? "managed" : "standin",
    fallback = process.env.AGENT_FALLBACK === "standin" ? "standin" : "none",
    model,
    managedOptions,
    loadManifest: lm,
    loadResults: lr,
    turn: givenTurn,
    ...loopDeps
  } = deps;

  if (claim.sceneId !== sceneId) return refuse(`Claim ${claim.id} belongs to scene ${claim.sceneId}, not ${sceneId}.`);

  let manifest: SceneManifest;
  let result: ClaimResult | undefined;
  try {
    manifest = await (lm ?? loadManifest)(sceneId);
    result = (await (lr ?? loadResults)(sceneId)).find((r) => r.claimId === claim.id);
  } catch (e) {
    if (e instanceof NotFoundError) return refuse(e.message);
    throw e;
  }
  if (!result) return refuse(`No result for claim ${claim.id} yet: run the pipeline on scene ${sceneId} first.`);

  // Excluded cameras never count: judge eligibility (isWeakSupport, disagreement) without their evidence.
  const counted: ClaimResult = { ...result, evidence: withoutExcluded(result.evidence, manifest.excludedCameras) };
  const eligibility = explainEligibility(counted, claim);
  if (eligibility.agent !== agent) {
    const hint = eligibility.agent ? ` Use the ${label(eligibility.agent)}.` : "";
    return refuse(`The ${label(agent)} does not run on claim ${claim.id}: ${eligibility.reason}${hint}`);
  }

  const run = (turn: (input: TurnInput) => Promise<TurnOutput>, ranAs: AgentMode, firstStepN = 1) =>
    runAgent(agent, claim, sceneId, { ...loopDeps, turn, mode: ranAs, firstStepN, start: { result, manifest } });
  const standin = (): ((input: TurnInput) => Promise<TurnOutput>) => standinTurnFn(model ?? createGenaiModel());

  // An injected turn runs as given, labelled with the requested mode (stand-in unless told otherwise).
  if (givenTurn) return { ran: true, run: await run(givenTurn, deps.mode ?? "standin") };

  // Each try covers only creating the turn function (e.g. no API key), never the run itself.
  type Turn = (input: TurnInput) => Promise<TurnOutput>;
  const make = (f: () => Turn): Turn | Error => {
    try {
      return f();
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  };

  if (mode === "standin") {
    const t = make(standin);
    return t instanceof Error ? refuse(`model unavailable: ${t.message}`) : { ran: true, run: await run(t, "standin") };
  }

  // Managed: one fresh session per run (one claim, one role); never reused across claims.
  const managed = make(() => createManagedTurn({ ...managedOptions, session: newSession() }));
  const managedRun = managed instanceof Error ? undefined : await run(managed, "managed");
  const failedFirstTurn =
    managedRun === undefined || (managedRun.stopReason === "model_unavailable" && managedRun.steps.length === 1);
  if (managedRun && (!failedFirstTurn || fallback !== "standin")) return { ran: true, run: managedRun };
  if (!managedRun && fallback !== "standin") return refuse(`model unavailable: ${(managed as Error).message}`);

  const fb = make(standin);
  if (fb instanceof Error) {
    return managedRun ? { ran: true, run: managedRun } : refuse(`model unavailable: ${fb.message}`);
  }
  // Continue the claim's step numbering after the failed managed step (managed n:1 -> fallback starts at n:2).
  const lastN = managedRun?.steps.at(-1)?.n ?? 0;
  return { ran: true, run: await run(fb, "standin-fallback", lastN + 1) };
}
