// OWNER: Dev 3. Request handlers behind the thin route files, testable without Next.js.
// Each returns { status, body }; the route turns it into a JSON response.
import { z } from "zod";
import { createScene } from "@/lib/store/scene";
import type { AgentName, Claim } from "@/lib/types";
import { startAgent, type AgentOutcome } from "@/lib/agent/start";
import { loadClaims, lockScene } from "@/lib/pipeline/run";

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
