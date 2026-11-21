// OWNER: Dev 3. Request handlers behind the thin route files, testable without Next.js.
// Each returns { status, body }; the route turns it into a JSON response.
import { z } from "zod";
import { createScene, loadManifest, loadResults, NotFoundError } from "@/lib/store/scene";
import type { AgentName, Claim, ClaimResult, SceneManifest, Verdict } from "@/lib/types";
import { explainEligibility, withoutExcluded } from "@/lib/agent/eligibility";
import { startAgent, type AgentOutcome } from "@/lib/agent/start";
import { lockScene } from "@/lib/store/scene";
import { defaultPipelineDeps, loadClaims, startPipeline, type StartResult } from "@/lib/pipeline/run";

export interface HandlerResult {
  status: number;
  body: unknown;
}

const SceneId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "invalid sceneId");
const Camera = z.enum(["A", "B", "C", "D"]);
const bad = (e: z.ZodError): HandlerResult => ({ status: 400, body: { error: z.prettifyError(e) } });

// ---------- POST /api/investigate, POST /api/skeptic ----------

const AgentRequestSchema = z.object({ sceneId: SceneId, claimId: z.string().min(1) });

export interface AgentRequestDeps {
  loadClaims: (sceneId: string) => Promise<Claim[]>;
  lockScene: (sceneId: string) => (() => void) | null;
  startAgent: (agent: AgentName, claim: Claim, sceneId: string) => Promise<AgentOutcome>;
}

export const defaultAgentRequestDeps: AgentRequestDeps = {
  loadClaims,
  lockScene,
  startAgent: (agent, claim, sceneId) => startAgent(agent, claim, sceneId), // respects AGENT_MODE
};

/**
 * Runs one agent on one claim on demand, under the scene's shared lock (409 if a pipeline or agent run
 * holds it). An ineligible claim is 200 { ran: false, reason } with explainEligibility()'s reason.
 */
export async function handleAgentRequest(
  agent: AgentName,
  body: unknown,
  deps: AgentRequestDeps = defaultAgentRequestDeps,
): Promise<HandlerResult> {
  const parsed = AgentRequestSchema.safeParse(body);
  if (!parsed.success) return bad(parsed.error);
  const { sceneId, claimId } = parsed.data;

  const claim = (await deps.loadClaims(sceneId)).find((c) => c.id === claimId);
  if (!claim) return { status: 404, body: { error: `Claim ${claimId} not found in scene ${sceneId}.` } };

  const release = deps.lockScene(sceneId);
  if (!release) return { status: 409, body: { error: `Scene ${sceneId} already has a run in progress.` } };
  try {
    const out = await deps.startAgent(agent, claim, sceneId);
    if (!out.ran) return { status: 200, body: { ran: false, reason: out.reason } };
    const { steps, result, stopReason, mode } = out.run;
    return { status: 200, body: { ran: true, steps, result, stopReason, mode } };
  } catch (e) {
    console.error(`[api/${agent}] ${sceneId}/${claimId}:`, e);
    return { status: 500, body: { error: "agent run failed" } };
  } finally {
    release();
  }
}

// ---------- POST /api/scene/start ----------

const SceneStartSchema = z.object({
  split: z.enum(["starter", "dev", "heldout", "demo"]),
  room: z.string().min(1),
  cameras: z.array(Camera).min(1),
  excludedCameras: z.array(Camera).default([]),
  plannedOcclusion: z.boolean().optional(),
  presynced: z.boolean().optional(),
  questionSet: z.string().min(1).optional(), // checked against QUESTION_SETS by createScene()
  roi: z.boolean().optional(),
});

/** Creates manifest.json for a new scene. files and durationS are filled in later by the pipeline's probe stage. */
export async function handleSceneStart(body: unknown): Promise<HandlerResult> {
  const parsed = SceneStartSchema.safeParse(body);
  if (!parsed.success) return bad(parsed.error);
  try {
    const manifest = await createScene(parsed.data);
    return { status: 201, body: { sceneId: manifest.sceneId } };
  } catch (e) {
    // createScene() rejects duplicate or stray cameras with a plain Error; file-system errors carry a code.
    if (e instanceof Error && !(e as NodeJS.ErrnoException).code) return { status: 400, body: { error: e.message } };
    console.error("[api/scene/start]", e);
    return { status: 500, body: { error: "could not create the scene" } };
  }
}

// ---------- POST /api/scene/[id]/run ----------

const LOCKED = (sceneId: string): HandlerResult => ({ status: 409, body: { error: `Scene ${sceneId} already has a run in progress.` } });

export interface RunStartDeps {
  loadManifest: (sceneId: string) => Promise<SceneManifest>;
  startPipeline: (sceneId: string) => StartResult;
}

export const defaultRunStartDeps: RunStartDeps = {
  loadManifest,
  startPipeline: (sceneId) => startPipeline(sceneId, defaultPipelineDeps),
};

/** Starts probe -> perceive for a scene in the background: 202 right away, 409 if the scene is held. */
export async function handleRunStart(sceneId: string, deps: RunStartDeps = defaultRunStartDeps): Promise<HandlerResult> {
  const id = SceneId.safeParse(sceneId);
  if (!id.success) return bad(id.error);
  try {
    await deps.loadManifest(sceneId);
  } catch (e) {
    if (e instanceof NotFoundError) return { status: 404, body: { error: e.message } };
    throw e;
  }
  const started = deps.startPipeline(sceneId);
  if (!started.started) return { status: 409, body: { error: started.reason } };
  return { status: 202, body: { sceneId, status: "queued" } };
}

// ---------- POST /api/scene/[id]/agents ----------

export interface AgentsRunDeps {
  loadManifest: (sceneId: string) => Promise<SceneManifest>;
  loadClaims: (sceneId: string) => Promise<Claim[]>;
  loadResults: (sceneId: string) => Promise<ClaimResult[]>;
  lockScene: (sceneId: string) => (() => void) | null;
  startAgent: (agent: AgentName, claim: Claim, sceneId: string) => Promise<AgentOutcome>;
}

export const defaultAgentsRunDeps: AgentsRunDeps = {
  loadManifest,
  loadClaims,
  loadResults,
  lockScene,
  startAgent: (agent, claim, sceneId) => startAgent(agent, claim, sceneId), // respects AGENT_MODE
};

export interface ClaimAgentOutcome {
  claimId: string;
  agent?: AgentName;
  ran: boolean;
  reason?: string;
  mode: string | null;
  before: Verdict | null;
  after: Verdict | null;
  stopReason?: string;
}

/**
 * Runs the eligible agent for every claim in claims.json, one claim at a time, under the scene lock (409 if
 * held). Eligibility is judged on the stored result without excluded cameras; ineligible claims and claims
 * with no result yet are reported with the reason and not run.
 */
export async function handleAgentsRun(sceneId: string, deps: AgentsRunDeps = defaultAgentsRunDeps): Promise<HandlerResult> {
  const id = SceneId.safeParse(sceneId);
  if (!id.success) return bad(id.error);
  let manifest: SceneManifest;
  try {
    manifest = await deps.loadManifest(sceneId);
  } catch (e) {
    if (e instanceof NotFoundError) return { status: 404, body: { error: e.message } };
    throw e;
  }

  const release = deps.lockScene(sceneId);
  if (!release) return LOCKED(sceneId);
  try {
    const claims = await deps.loadClaims(sceneId);
    if (claims.length === 0) return { status: 404, body: { error: `No claims for scene ${sceneId} yet: submit the account first.` } };
    const results = new Map((await deps.loadResults(sceneId)).map((r) => [r.claimId, r]));

    const out: ClaimAgentOutcome[] = [];
    for (const claim of claims) {
      const result = results.get(claim.id);
      if (!result) {
        out.push({ claimId: claim.id, ran: false, reason: "No result for this claim yet: submit the account first.", mode: null, before: null, after: null });
        continue;
      }
      const counted = { ...result, evidence: withoutExcluded(result.evidence, manifest.excludedCameras) };
      const eligibility = explainEligibility(counted, claim);
      if (!eligibility.agent) {
        out.push({ claimId: claim.id, ran: false, reason: eligibility.reason, mode: null, before: result.verdict, after: result.verdict });
        continue;
      }
      const agent = eligibility.agent;
      const o = await deps.startAgent(agent, claim, sceneId); // sequential: one claim at a time
      out.push(
        o.ran
          ? { claimId: claim.id, agent, ran: true, mode: o.run.mode ?? null, before: result.verdict, after: o.run.result.verdict, stopReason: o.run.stopReason }
          : { claimId: claim.id, agent, ran: false, reason: o.reason, mode: null, before: result.verdict, after: result.verdict },
      );
    }
    return { status: 200, body: { sceneId, claims: out } };
  } catch (e) {
    console.error(`[api/agents] ${sceneId}:`, e);
    return { status: 500, body: { error: "agent runs failed" } };
  } finally {
    release();
  }
}
