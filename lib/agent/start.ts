// OWNER: Dev 3. Shared entry point for investigate() and challenge(): load the claim's current result and the
// manifest from the store, check eligibility, pick the turn function (stand-in by default) and run the loop.
// Every reason not to run comes back as { ran: false, reason }, never as a thrown error.
import { loadManifest, loadResults, NotFoundError } from "@/lib/store/scene";
import type { AgentName, Claim, ClaimResult, SceneManifest } from "@/lib/types";
import { explainEligibility, withoutExcluded } from "@/lib/agent/eligibility";
import { createGenaiModel } from "@/lib/agent/genai-turn";
import { runAgent, type AgentDeps, type AgentRun } from "@/lib/agent/loop";
import { standinTurnFn, type StandinModel } from "@/lib/agent/standin";

export type AgentOutcome = { ran: true; run: AgentRun } | { ran: false; reason: string };

export interface StartAgentDeps extends Partial<Omit<AgentDeps, "start">> {
  /** "standin" (default): ordinary Gemini function-calling turn. "managed": Gemini Managed Agent. */
  mode?: "standin" | "managed";
  /** Stand-in model; defaults to createGenaiModel(). Ignored when turn is given. */
  model?: StandinModel;
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
  const { mode = "standin", model, loadManifest: lm, loadResults: lr, turn: givenTurn, ...loopDeps } = deps;

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

  let turn = givenTurn;
  if (!turn) {
    if (mode === "managed") {
      // TODO(Dev 3, at the event): managed-agent turn via the Interactions API (environment.ts) once the
      // field names for tool results and resuming an environment are confirmed.
      return refuse("Managed agent mode is not implemented yet: use the stand-in.");
    }
    try {
      turn = standinTurnFn(model ?? createGenaiModel());
    } catch (e) {
      return refuse(`model unavailable: ${errMsg(e)}`);
    }
  }

  const run = await runAgent(agent, claim, sceneId, { ...loopDeps, turn, start: { result, manifest } });
  return { ran: true, run };
}
