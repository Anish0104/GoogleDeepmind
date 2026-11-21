// OWNER: Dev 3. The Gemini Managed Agent (Antigravity, Interactions API) as a turn function for runAgent().
// Same turn interface as the stand-in, so the loop, bridge and menu are unchanged.
//
// Field names come from a real round trip with scripts/probe-agent.ts and the @google/genai types:
// - create: agent, agent_config {type:"antigravity", max_total_tokens (number)}, environment, system_instruction,
//   tools [{type:"function", name, description, parameters}], input, previous_interaction_id; api_version v1beta.
// - response: id, status, environment_id, steps[] (function_call {id, name, arguments}; function_result
//   {call_id}), output_text, usage {total_input_tokens, total_output_tokens, total_thought_tokens, ...}.
// - a function result goes back as input [{type:"function_result", call_id, name, result, is_error?}] with
//   previous_interaction_id and environment = environment_id. Signatures are never sent back.
// Never background: the SDK rejects background together with automatic_continuation: false, and we need
// automatic_continuation off so every requires_action comes back to our bridge.
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { LIMITS, MODELS } from "@/lib/config";
import { recordCost } from "@/lib/cost";
import type { AgentName, AgentStep } from "@/lib/types";
import { newSession, type AgentSession, type PendingCall } from "@/lib/agent/environment";
import { withRetry } from "@/lib/agent/genai-turn";
import type { TurnInput, TurnOutput } from "@/lib/agent/loop";
import { SYSTEM_PROMPTS } from "@/lib/agent/prompts";
import { buildUserMessage } from "@/lib/agent/standin";

export const API_VERSION = "v1beta";
export const NEXT_LINE = "Call inspect_window for another allowed clip, or call stop.";
const POLL_BACKOFF_MS = [500, 1000, 2000, 4000] as const;
const IMPLICIT_STOP_FALLBACK = "The agent finished without calling stop.";
const MAX_REASON_CHARS = 300;

// ---------- tools: only our two functions (no code_execution, google_search or url_context) ----------

export const MANAGED_TOOLS = [
  {
    type: "function" as const,
    name: "inspect_window",
    description:
      "Check one short clip from one camera. Use only a camera in includedCameras and a window inside " +
      "allowedRangeS that is 1-4 s long, overlaps the claim window and does not overlap alreadyChecked.",
    parameters: {
      type: "object",
      properties: {
        camera_id: { type: "string", enum: ["A", "B", "C", "D"], description: "Camera to check." },
        start_s: { type: "number", minimum: 0, description: "Clip start, seconds from scene start." },
        end_s: { type: "number", minimum: 0, description: "Clip end, seconds from scene start." },
        crop: { type: "string", enum: ["full", "entity"], description: "full frame, or cropped to the claim's object." },
        reason: { type: "string", description: "One sentence: why this clip could settle or break the label." },
      },
      required: ["camera_id", "start_s", "end_s", "crop", "reason"],
    },
  },
  {
    type: "function" as const,
    name: "stop",
    description: "Stop when no allowed clip could change the result.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string", description: "One sentence: why you are stopping." } },
      required: ["reason"],
    },
  },
];

// ---------- request / response shapes ----------

export interface FunctionResultInput {
  type: "function_result";
  call_id: string;
  name: string;
  result: Record<string, unknown>;
  is_error?: true;
}

export interface ManagedCreateParams {
  api_version: string;
  agent: string;
  agent_config: { type: "antigravity"; max_total_tokens: number; model?: string };
  environment: string;
  system_instruction: string;
  tools: typeof MANAGED_TOOLS;
  input: string | FunctionResultInput[];
  previous_interaction_id?: string;
  stream: false;
  automatic_continuation: false;
}

/** The part of GoogleGenAI.interactions this adapter uses; tests inject a fake. */
export interface InteractionsClient {
  create(params: ManagedCreateParams): Promise<unknown>;
  get(id: string, params: { api_version: string }): Promise<unknown>;
}

const StepSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  call_id: z.string().optional(),
  name: z.string().optional(),
  arguments: z.unknown().optional(),
});
const count = z.number().nonnegative().optional();
const InteractionSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  environment_id: z.string().optional(),
  output_text: z.string().optional(),
  steps: z.array(StepSchema).optional(),
  usage: z
    .looseObject({
      total_input_tokens: count,
      total_output_tokens: count,
      total_thought_tokens: count,
      total_cached_tokens: count,
    })
    .optional(),
  errors: z.array(z.unknown()).optional(),
});
type Interaction = z.infer<typeof InteractionSchema>;

function parseInteraction(raw: unknown): Interaction {
  const r = InteractionSchema.safeParse(raw);
  if (!r.success) throw new Error(`unexpected Interactions API response: ${z.prettifyError(r.error)}`);
  return r.data;
}

// ---------- helpers ----------

/** First sentence of the agent's closing text, for an implicit stop's reason. */
export function firstSentence(text: string | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return IMPLICIT_STOP_FALLBACK;
  const m = t.match(/^.+?[.!?](?=\s|$)/);
  return (m ? m[0] : t).slice(0, MAX_REASON_CHARS);
}

/** Function calls with no function_result for the same call_id, in step order. */
export function pendingCalls(steps: Interaction["steps"]): PendingCall[] {
  const all = steps ?? [];
  const answered = new Set(all.filter((s) => s.type === "function_result").map((s) => s.call_id));
  return all
    .filter((s) => s.type === "function_call" && s.id && !answered.has(s.id))
    .map((s) => ({ id: s.id!, name: s.name ?? "" }));
}

function argsOf(steps: Interaction["steps"], id: string): unknown {
  return (steps ?? []).find((s) => s.type === "function_call" && s.id === id)?.arguments ?? {};
}

/** The function_result for the call the loop just handled, built from its AgentStep. */
function resultFor(call: PendingCall, step: AgentStep | undefined, followUpsLeft: number): FunctionResultInput {
  const base = { type: "function_result" as const, call_id: call.id, name: call.name };
  if (step?.action === "inspect_window" && step.result) {
    const e = step.result;
    return {
      ...base,
      result: {
        evidence: { camera: e.camera, window: e.window, visible: e.visible, supports: e.supports, contradicts: e.contradicts },
        followUpsLeft,
        next: NEXT_LINE,
      },
    };
  }
  return {
    ...base,
    is_error: true,
    result: { error: step?.rejectionReason ?? "The call was not run.", followUpsLeft, next: NEXT_LINE },
  };
}

const extraResult = (call: PendingCall, followUpsLeft: number): FunctionResultInput => ({
  type: "function_result",
  call_id: call.id,
  name: call.name,
  is_error: true,
  result: {
    error: "Ignored: only one tool call per turn is handled. Make one call at a time.",
    followUpsLeft,
    next: NEXT_LINE,
  },
});

function realClient(apiKey: string): InteractionsClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    // The SDK's create() is heavily overloaded; ManagedCreateParams matches its non-streaming agent overload.
    create: (p) => ai.interactions.create(p as unknown as Parameters<typeof ai.interactions.create>[0]),
    get: (id, p) => ai.interactions.get(id, p),
  };
}

// ---------- the turn function ----------

export interface ManagedTurnOptions {
  client?: InteractionsClient;
  apiKey?: string;
  /** Fresh per run by default. Never pass one session to two claims. */
  session?: AgentSession;
  agentId?: string;
  /** agent_config.model; MODELS.AGENT_MODEL when unset (omitted if that is empty). */
  model?: string;
  timeoutMs?: number;
  logPath?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds, for latency and the in_progress timeout. */
  clock?: () => number;
  now?: () => Date;
}

/**
 * A turn function for runAgent() backed by one Managed Agent session. Throws (so the loop records
 * model_unavailable) on failed / cancelled / incomplete or any other non-actionable status, an in_progress
 * timeout, an unexpected response, or an SDK error that survives the MODEL_RETRY_DELAYS_MS retries.
 */
export function createManagedTurn(opts: ManagedTurnOptions = {}): (input: TurnInput) => Promise<TurnOutput> {
  let client = opts.client;
  if (!client) {
    const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set: add it to .env.local to use the managed agent.");
    client = realClient(apiKey);
  }
  const api = client;
  const session = opts.session ?? newSession();
  const agentId = opts.agentId ?? MODELS.AGENT_ID;
  const model = opts.model ?? MODELS.AGENT_MODEL;
  const timeoutMs = opts.timeoutMs ?? LIMITS.AGENT_TURN_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const clock = opts.clock ?? (() => performance.now());
  const now = opts.now ?? (() => new Date());
  let warnedNoPrices = false;

  const price = (v: string | undefined) => {
    const n = v === undefined || v.trim() === "" ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  /** USD from MANAGED_PRICE_IN / MANAGED_PRICE_OUT (per 1M tokens). 0 with one warning per run if unset. */
  const usdFor = (inputTokens: number, outputTokens: number) => {
    const pin = price(process.env.MANAGED_PRICE_IN);
    const pout = price(process.env.MANAGED_PRICE_OUT);
    if (pin === null || pout === null) {
      if (!warnedNoPrices) {
        warnedNoPrices = true;
        console.warn("[managed] MANAGED_PRICE_IN / MANAGED_PRICE_OUT are unset or invalid: logging managed-agent calls as $0.");
      }
      return 0;
    }
    return (inputTokens * pin + outputTokens * pout) / 1_000_000;
  };

  const params = (agent: AgentName, input: ManagedCreateParams["input"]): ManagedCreateParams => ({
    api_version: API_VERSION,
    agent: agentId,
    agent_config: { type: "antigravity", max_total_tokens: LIMITS.AGENT_MAX_TOTAL_TOKENS, ...(model ? { model } : {}) },
    environment: session.environmentId ?? "remote",
    system_instruction: SYSTEM_PROMPTS[agent],
    tools: MANAGED_TOOLS,
    input,
    ...(session.interactionId ? { previous_interaction_id: session.interactionId } : {}),
    stream: false,
    automatic_continuation: false,
  });

  /** Polls while queued / in_progress with backoff, until the turn's time runs out. */
  const settle = async (first: Interaction, started: number): Promise<Interaction> => {
    let cur = first;
    for (let i = 0; cur.status === "in_progress" || cur.status === "queued"; i++) {
      const left = timeoutMs - (clock() - started);
      if (left <= 0) throw new Error(`managed agent still ${cur.status} after ${timeoutMs} ms`);
      await sleep(Math.min(POLL_BACKOFF_MS[Math.min(i, POLL_BACKOFF_MS.length - 1)]!, left));
      cur = parseInteraction(await withRetry(() => api.get(cur.id, { api_version: API_VERSION }), { sleep }));
    }
    return cur;
  };

  return async ({ agent, menu, history }: TurnInput): Promise<TurnOutput> => {
    const started = clock();

    let input: ManagedCreateParams["input"];
    if (session.interactionId === undefined) {
      input = buildUserMessage(menu, history); // claim + menu (views, still ids) as the first input
    } else {
      if (!session.pending) throw new Error("managed agent: no pending call to answer");
      if (menu.followUpsLeft <= 0) {
        // The loop never asks for a turn with no follow-ups left; if it did, don't spend tokens sending a result.
        return { name: "stop", args: { reason: "No follow-ups left." }, implicitStop: true, tokens: 0, costUsd: 0, latencyMs: 0 };
      }
      input = [
        resultFor(session.pending, history.at(-1), menu.followUpsLeft),
        ...(session.extra ?? []).map((c) => extraResult(c, menu.followUpsLeft)),
      ];
    }
    const request = params(agent, input);
    session.pending = undefined;
    session.extra = undefined;

    let it = parseInteraction(await withRetry(() => api.create(request), { sleep }));
    session.interactionId = it.id;
    session.environmentId ??= it.environment_id;
    it = await settle(it, started);
    session.interactionId = it.id;
    session.environmentId ??= it.environment_id;

    // Log usage whatever the status: the tokens were spent.
    const u = it.usage ?? {};
    const inputTokens = u.total_input_tokens ?? 0;
    const outputTokens = (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0); // thinking bills as output
    const costUsd = usdFor(inputTokens, outputTokens);
    await recordCost(
      {
        at: now().toISOString(),
        model: model ? `${agentId}/${model}` : agentId,
        purpose: `managed-${agent}`,
        inputTokens,
        outputTokens,
        cachedTokens: u.total_cached_tokens ?? 0,
        usd: costUsd,
        sceneId: menu.claim.sceneId,
      },
      opts.logPath,
    );
    const usage = { tokens: inputTokens + outputTokens, costUsd, latencyMs: Math.round(clock() - started) };

    if (it.status !== "requires_action" && it.status !== "completed") {
      const detail = it.errors?.length ? `: ${JSON.stringify(it.errors[0]).slice(0, 200)}` : "";
      throw new Error(`managed agent ${it.status}${detail}`);
    }
    const [first, ...rest] = pendingCalls(it.steps);
    if (first) {
      // Like the stand-in, only the first call is handled; the rest go back as is_error results next turn.
      session.pending = first;
      session.extra = rest.length ? rest : undefined;
      return { name: first.name, args: argsOf(it.steps, first.id), ...usage };
    }
    if (it.status === "requires_action") throw new Error("managed agent requires_action with no pending function call");
    return { name: "stop", args: { reason: firstSentence(it.output_text) }, implicitStop: true, ...usage };
  };
}
