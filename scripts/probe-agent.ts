// OWNER: Dev 3. Manual probe, not run in CI: one Gemini Managed Agent (Antigravity) interaction through the
// Interactions API, to see the real requires_action / function_call shape and how a function result goes back.
// Usage: pnpm tsx scripts/probe-agent.ts [investigator|skeptic] [--no-reply]
//
// Field names are from the installed @google/genai types (CreateAgentInteraction, AntigravityAgentConfig,
// FunctionT, FunctionCallStep, FunctionResultStep, Interaction) and the Antigravity / custom-agents docs.
// Every call passes api_version "v1beta" explicitly (all doc samples use v1beta).
//
// Round 1: create the interaction (blocking; polls only if it comes back in_progress) with ONLY our two
// function tools. automatic_continuation is off so every requires_action stops here.
// Round 2 (unless --no-reply): if it stops at requires_action with one of our function calls, send back a
// FAKE function_result (no video is checked) via previous_interaction_id + environment_id, poll, print.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, type GoogleGenAIInteraction } from "@google/genai";
import type { AgentMenu, AgentName } from "@/lib/types";
import { LIMITS, MODELS } from "@/lib/config";
import { assertBudget } from "@/lib/cost";
import { parseToolCall, validate } from "@/lib/agent/bridge";
import { appendCostRecord } from "@/lib/agent/genai-turn";
import { INSPECT_WINDOW_DESCRIPTION, STOP_DESCRIPTION, SYSTEM_PROMPTS } from "@/lib/agent/prompts";
import { buildUserMessage } from "@/lib/agent/standin";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const API_VERSION = "v1beta";
const POLL_MS = 2_000;
const TIMEOUT_MS = 180_000;

const agentName = (process.argv.find((a) => a === "investigator" || a === "skeptic") ?? "investigator") as AgentName;
const reply = !process.argv.includes("--no-reply");

// ---------- the two function tools, as JSON Schema (mirrors InspectWindowArgsSchema / StopArgsSchema) ----------
const TOOLS = [
  {
    type: "function" as const,
    name: "inspect_window",
    description: INSPECT_WINDOW_DESCRIPTION,
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
    description: STOP_DESCRIPTION,
    parameters: {
      type: "object",
      properties: { reason: { type: "string", description: "One sentence: why you are stopping." } },
      required: ["reason"],
    },
  },
];
const OUR_TOOLS = new Set(TOOLS.map((t) => t.name));

// max_total_tokens is sent as a NUMBER, as in the docs' budget example. The SDK type (AntigravityAgentConfig)
// says string, hence the cast; this probe is meant to show which one the API accepts.
type AgentConfigType = { type: "antigravity"; max_total_tokens?: string; model?: string };
const AGENT_CONFIG = {
  type: "antigravity" as const,
  max_total_tokens: LIMITS.AGENT_MAX_TOTAL_TOKENS,
  ...(MODELS.AGENT_MODEL ? { model: MODELS.AGENT_MODEL } : {}),
} as unknown as AgentConfigType;

// ---------- helpers ----------
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set (add it to .env.local).");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Interaction = GoogleGenAIInteraction;
type AnyStep = { type: string; id?: string; call_id?: string; name?: string; arguments?: Record<string, unknown> };

function printRaw(label: string, x: unknown) {
  const { sdkHttpResponse, ...body } = x as { sdkHttpResponse?: { headers?: unknown } } & Record<string, unknown>;
  console.log(`\n========== ${label} (raw) ==========`);
  console.log(JSON.stringify(body, null, 2));
  if (sdkHttpResponse) console.log(`(sdkHttpResponse omitted; keys: ${Object.keys(sdkHttpResponse).join(", ")})`);
}

function managedUsd(inputTokens: number, outputTokens: number): number {
  const num = (v: string | undefined) => {
    const n = v === undefined || v.trim() === "" ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const pin = num(process.env.MANAGED_PRICE_IN);
  const pout = num(process.env.MANAGED_PRICE_OUT);
  if (pin === null || pout === null) return 0;
  return (inputTokens * pin + outputTokens * pout) / 1_000_000;
}

async function logUsage(i: Interaction, sceneId: string) {
  const u = i.usage;
  const inputTokens = u?.total_input_tokens ?? 0;
  const outputTokens = (u?.total_output_tokens ?? 0) + (u?.total_thought_tokens ?? 0);
  const usd = managedUsd(inputTokens, outputTokens);
  await appendCostRecord({
    at: new Date().toISOString(),
    model: `${MODELS.AGENT_ID}${MODELS.AGENT_MODEL ? `/${MODELS.AGENT_MODEL}` : ""}`,
    purpose: "probe-agent",
    inputTokens,
    outputTokens,
    usd,
    sceneId,
  });
  console.log(`\nUsage: ${JSON.stringify(u ?? null)} (usd=${usd.toFixed(6)})`);
}

/** Waits while the background interaction is queued or running. Cancels on timeout. */
async function settle(first: Interaction): Promise<Interaction> {
  let cur = first;
  const started = Date.now();
  while (cur.status === "in_progress" || cur.status === "queued") {
    if (Date.now() - started > TIMEOUT_MS) {
      console.error(`Timed out after ${TIMEOUT_MS / 1000} s; cancelling ${cur.id}.`);
      await ai.interactions.cancel(cur.id, { api_version: API_VERSION });
      break;
    }
    process.stdout.write(`  status=${cur.status} … polling\n`);
    await sleep(POLL_MS);
    cur = await ai.interactions.get(cur.id, { api_version: API_VERSION });
    printRaw(`poll ${cur.id}`, cur);
  }
  return cur;
}

/** Function calls to OUR tools with no matching function_result yet (filesystem tools run by themselves). */
function pendingCalls(i: Interaction): AnyStep[] {
  const steps = (i.steps ?? []) as AnyStep[];
  const answered = new Set(steps.filter((s) => s.type === "function_result").map((s) => s.call_id));
  return steps.filter((s) => s.type === "function_call" && s.id && !answered.has(s.id) && OUR_TOOLS.has(s.name ?? ""));
}

function summarise(label: string, i: Interaction) {
  const steps = (i.steps ?? []) as AnyStep[];
  console.log(`\n---------- ${label} summary ----------`);
  console.log(`id=${i.id} status=${i.status} environment_id=${i.environment_id ?? "(none)"}`);
  console.log(`steps: ${steps.map((s) => `${s.type}${s.name ? `:${s.name}` : ""}`).join(", ") || "(none)"}`);
  for (const s of steps.filter((x) => x.type === "function_call")) {
    console.log(`  function_call id=${s.id} name=${s.name} arguments=${JSON.stringify(s.arguments)}`);
  }
}

// ---------- run ----------
const menu: AgentMenu = {
  ...(JSON.parse(await readFile(path.join(process.cwd(), "fixtures/agent-menu.sample.json"), "utf8")) as AgentMenu),
  agent: agentName,
};
const input = buildUserMessage(menu, []);

console.log(`agent=${MODELS.AGENT_ID} agent_config=${JSON.stringify(AGENT_CONFIG)} environment=remote api_version=${API_VERSION}`);
console.log(`tools=${TOOLS.map((t) => t.name).join(", ")} (no code_execution / google_search / url_context)`);
console.log(`role=${agentName} claim="${menu.claim.text}"`);

await assertBudget();
let round1 = await ai.interactions.create({
  api_version: API_VERSION,
  agent: MODELS.AGENT_ID,
  agent_config: AGENT_CONFIG,
  environment: "remote",
  system_instruction: SYSTEM_PROMPTS[agentName],
  tools: TOOLS,
  input,
  // No background: true. The SDK rejects it together with automatic_continuation: false, and we need
  // automatic_continuation off so every requires_action tool call comes back to our bridge.
  stream: false,
  automatic_continuation: false,
});
printRaw("round 1: create response", round1);
round1 = await settle(round1);
printRaw("round 1: settled", round1);
summarise("round 1", round1);
await logUsage(round1, menu.claim.sceneId);

const pending = pendingCalls(round1);
if (!reply || round1.status !== "requires_action" || pending.length === 0) {
  console.log(
    `\nNot sending a function result (reply=${reply}, status=${round1.status}, pending calls to our tools=${pending.length}).`,
  );
  process.exit(0);
}

// Fake result for the first pending call: what the real adapter would send after checkWindow() + audit().
const call = pending[0]!;
const parsed = parseToolCall(call.name ?? "", call.arguments ?? {});
let result: Record<string, unknown>;
let isError = false;
if (!parsed.ok) {
  result = { error: parsed.reason };
  isError = true;
} else if (parsed.call.name === "stop") {
  result = { acknowledged: true };
} else {
  const v = validate(parsed.call.args, menu);
  if (!v.ok) {
    result = { error: v.reason };
    isError = true;
  } else {
    result = {
      note: "FAKE result from scripts/probe-agent.ts: no video was checked.",
      evidence: {
        camera: parsed.call.args.camera_id,
        window: [parsed.call.args.start_s, parsed.call.args.end_s],
        visible: 0.9,
        supports: 0.85,
      },
      followUpsLeft: menu.followUpsLeft - 1,
    };
  }
}
const functionResult = {
  type: "function_result" as const,
  call_id: call.id!,
  name: call.name,
  result,
  ...(isError ? { is_error: true } : {}),
};
console.log(`\nSending function_result: ${JSON.stringify(functionResult)}`);

await assertBudget();
// tools and system_instruction are per interaction, so they are sent again on the continuation.
let round2 = await ai.interactions.create({
  api_version: API_VERSION,
  agent: MODELS.AGENT_ID,
  agent_config: AGENT_CONFIG,
  environment: round1.environment_id ?? "remote",
  previous_interaction_id: round1.id,
  system_instruction: SYSTEM_PROMPTS[agentName],
  tools: TOOLS,
  input: [functionResult],
  // No background: true. The SDK rejects it together with automatic_continuation: false, and we need
  // automatic_continuation off so every requires_action tool call comes back to our bridge.
  stream: false,
  automatic_continuation: false,
});
printRaw("round 2: create response", round2);
round2 = await settle(round2);
printRaw("round 2: settled", round2);
summarise("round 2", round2);
await logUsage(round2, menu.claim.sceneId);
