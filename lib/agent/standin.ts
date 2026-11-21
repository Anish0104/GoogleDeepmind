// OWNER: Dev 3. An ordinary model call with the same two tools (inspect_window, stop).
// Used for development on the free tier and as the "ordinary model call" in the agent comparison.
// The model sits behind StandinModel so tests use a fake; the real adapter is lib/agent/genai-turn.ts.
import type { AgentMenu, AgentStep } from "@/lib/types";
import type { ToolCall } from "@/lib/agent/bridge";
import type { TurnInput, TurnOutput } from "@/lib/agent/loop";
import { CLIP_OVERLAP_RULE, STILLS_NOTE, SYSTEM_PROMPTS } from "@/lib/agent/prompts";
import { menuForAgent, rejectionFeedback } from "@/lib/agent/feedback";

export type { ToolCall };

/** Tool name reported when the model answers in text instead of calling a tool (rejected by the bridge). */
export const NO_TOOL_CALL = "(no tool call)";
const MAX_TEXT_CHARS = 500;

export interface ModelRequest {
  systemInstruction: string;
  userText: string;
  /** For the cost log only. */
  sceneId?: string;
}

export interface ModelReply {
  /** The first function call, unparsed. null when the model replied with text only. */
  call: { name: string; args: unknown } | null;
  text: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface StandinModel {
  generate(req: ModelRequest): Promise<ModelReply>;
}

/**
 * What the agent saw of an earlier step: its call, any rejection (with the claim window and a valid example
 * window) and the clip's scores. No usage data.
 */
function summariseStep(s: AgentStep, menu: AgentMenu) {
  const fb = s.action === "rejected" ? rejectionFeedback(s, menu) : undefined;
  return {
    n: s.n,
    action: s.action,
    args: s.args,
    ...(s.rejectionReason ? { rejectionReason: s.rejectionReason } : {}),
    ...(fb ? { claimWindowS: fb.claimWindowS, ...(fb.validExample ? { validExample: fb.validExample } : {}) } : {}),
    ...(s.result
      ? {
          result: {
            camera: s.result.camera,
            window: s.result.window,
            visible: s.result.visible,
            supports: s.result.supports,
            contradicts: s.result.contradicts,
            clipId: s.result.clipId,
          },
        }
      : {}),
  };
}

/**
 * The one user message for a turn: the allowlisted menu as JSON (stills as IDs only for now)
 * plus a summary of this agent's own earlier steps. Nothing outside the menu goes in.
 */
export function buildUserMessage(menu: AgentMenu, history: AgentStep[]): string {
  const steps = history.length ? JSON.stringify(history.map((s) => summariseStep(s, menu))) : "none";
  return [
    "Menu (the only cameras, windows and facts you may use):",
    JSON.stringify(menuForAgent(menu)),
    "",
    CLIP_OVERLAP_RULE,
    STILLS_NOTE,
    "",
    `Your earlier steps: ${steps}`,
    "",
    "Call exactly one tool: inspect_window or stop.",
  ].join("\n");
}

/** One stand-in turn. Returns the raw tool call for the loop to parse; text replies become NO_TOOL_CALL. */
export async function standinTurn(
  systemPrompt: string,
  menu: AgentMenu,
  history: AgentStep[],
  model: StandinModel,
  clock: () => number = () => performance.now(),
): Promise<TurnOutput> {
  const started = clock();
  const reply = await model.generate({
    systemInstruction: systemPrompt,
    userText: buildUserMessage(menu, history),
    sceneId: menu.claim.sceneId,
  });
  const latencyMs = Math.round(clock() - started);
  const usage = { tokens: reply.inputTokens + reply.outputTokens, costUsd: reply.costUsd, latencyMs };
  if (reply.call) return { name: reply.call.name, args: reply.call.args, ...usage };
  return { name: NO_TOOL_CALL, args: { text: (reply.text ?? "").slice(0, MAX_TEXT_CHARS) }, ...usage };
}

/** Adapts a StandinModel to the loop's turn function, using the agent's system prompt. */
export function standinTurnFn(model: StandinModel): (input: TurnInput) => Promise<TurnOutput> {
  return ({ agent, menu, history }) => standinTurn(SYSTEM_PROMPTS[agent], menu, history, model);
}
