// OWNER: Dev 1. The one Gemini client every dev calls. Logs a CostRecord per call
// to logs/costs.jsonl and respects LIMITS.MAX_CONCURRENT_CALLS (free tier: keep low).
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { z, type ZodType } from "zod";
import type { CostRecord } from "@/lib/types";
import { COST_LOG, LIMITS, MODELS } from "@/lib/config";

export interface CallContext {
  purpose: string; // e.g. "scout", "lattice", "auditor", "judge"
  sceneId?: string;
}

// ---------- parts ----------

/** Provider-neutral input part. Build with textPart() / mediaPart(). */
export type Part = { kind: "text"; text: string } | { kind: "media"; mimeType: string; data: string };

/** Accepts our Part, or the SDK's own { text } / { inlineData: { mimeType, data } } shapes. */
const PartSchema = z.union([
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("media"), mimeType: z.string().min(1), data: z.string().min(1) }),
  z.object({ text: z.string() }).transform((p): Part => ({ kind: "text", text: p.text })),
  z
    .object({ inlineData: z.object({ mimeType: z.string().min(1), data: z.string().min(1) }) })
    .transform((p): Part => ({ kind: "media", mimeType: p.inlineData.mimeType, data: p.inlineData.data })),
]);
const PartsSchema = z.array(PartSchema).min(1);

export const textPart = (text: string): Part => ({ kind: "text", text });

/** `data` is base64. */
export const mediaPart = (data: string, mimeType: string): Part => ({ kind: "media", mimeType, data });

// ---------- pricing ----------

/** USD per 1M tokens. Unconfirmed placeholders that err high, so the budget stop trips early. */
const PRICES: Record<string, { input: number; output: number }> = {};
const DEFAULT_PRICE = { input: 1.25, output: 10 };

export function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? DEFAULT_PRICE;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

// ---------- SDK seam ----------

interface GenerateRequest {
  model: string;
  contents: { role: "user"; parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] }[];
  config?: { responseMimeType?: string; responseJsonSchema?: unknown };
}

interface GenerateResponse {
  text?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

type DecisionInput =
  | { type: "text"; text: string }
  | { type: "image" | "video" | "audio"; mime_type: string; data: string };

type DecisionQuestionWire =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

interface DecisionRequest {
  api_version: string;
  model: string;
  input: DecisionInput[];
  questions: Record<string, DecisionQuestionWire>;
}

/** The slice of the SDK this module uses; tests pass a fake. */
export interface GenAILike {
  models: { generateContent(req: GenerateRequest): Promise<GenerateResponse> };
  decisions: { create(req: DecisionRequest): Promise<unknown> };
}

interface Hooks {
  ai?: GenAILike;
  costLogPath: string;
  sleep: (ms: number) => Promise<void>;
  maxAttempts: number;
  maxConcurrent: number;
}

const defaultHooks = (): Hooks => ({
  costLogPath: COST_LOG,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttempts: 5,
  maxConcurrent: LIMITS.MAX_CONCURRENT_CALLS,
});

let hooks: Hooks = defaultHooks();

/** Test-only. */
export function __setTestHooks(h: Partial<Hooks>): void {
  hooks = { ...hooks, ...h };
}

/** Test-only. */
export function __resetTestHooks(): void {
  hooks = defaultHooks();
  resetClientStats();
  waiting.length = 0;
  active = 0;
}

let realAi: GenAILike | undefined;

function ai(): GenAILike {
  if (hooks.ai) return hooks.ai;
  if (!realAi) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set (see .env.local.example)");
    realAi = new GoogleGenAI({ apiKey }) as unknown as GenAILike;
  }
  return realAi;
}

// ---------- concurrency + retries ----------

export interface ClientStats {
  calls: number;
  retries: number;
  rateLimited: number;
  failures: number;
}

const stats: ClientStats = { calls: 0, retries: 0, rateLimited: 0, failures: 0 };

/** Counters since start (or the last reset): attempts, retries, 429s seen, calls that finally failed. */
export function clientStats(): ClientStats {
  return { ...stats };
}

export function resetClientStats(): void {
  Object.assign(stats, { calls: 0, retries: 0, rateLimited: 0, failures: 0 });
}

let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= Math.max(1, hooks.maxConcurrent)) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number") return RETRYABLE.has(status);
  // No HTTP status: network failure or timeout.
  return err instanceof Error && !(err instanceof z.ZodError);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      stats.calls++;
      // The slot is released between attempts so a backoff doesn't block other calls.
      return await withSlot(fn);
    } catch (err) {
      if ((err as { status?: unknown } | null)?.status === 429) stats.rateLimited++;
      if (attempt >= hooks.maxAttempts || !isRetryable(err)) {
        stats.failures++;
        throw err;
      }
      stats.retries++;
      const backoff = Math.min(16_000, 1_000 * 2 ** (attempt - 1));
      await hooks.sleep(backoff + Math.random() * 250);
    }
  }
}

// ---------- cost log ----------

export function logCost(record: CostRecord): void {
  mkdirSync(path.dirname(hooks.costLogPath), { recursive: true });
  appendFileSync(hooks.costLogPath, JSON.stringify(record) + "\n");
}

function record(model: string, ctx: CallContext, inputTokens: number, outputTokens: number): void {
  logCost({
    at: new Date().toISOString(),
    model,
    purpose: ctx.purpose,
    inputTokens,
    outputTokens,
    usd: estimateUsd(model, inputTokens, outputTokens),
    ...(ctx.sceneId !== undefined ? { sceneId: ctx.sceneId } : {}),
  });
}

// ---------- generateJson ----------

function stripFence(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return m ? m[1]! : text;
}

function jsonSchemaFor(schema: ZodType): unknown {
  try {
    return z.toJSONSchema(schema);
  } catch {
    return undefined; // schemas with transforms can't be expressed; zod still validates the output
  }
}

/** Text + image/video parts in, JSON out, parsed with the given zod schema. */
export async function generateJson<T>(model: string, parts: unknown[], schema: ZodType<T>, ctx: CallContext): Promise<T> {
  const valid: Part[] = PartsSchema.parse(parts);
  const responseJsonSchema = jsonSchemaFor(schema);
  const req: GenerateRequest = {
    model,
    contents: [
      {
        role: "user",
        parts: valid.map((p) => (p.kind === "text" ? { text: p.text } : { inlineData: { mimeType: p.mimeType, data: p.data } })),
      },
    ],
    config: { responseMimeType: "application/json", ...(responseJsonSchema ? { responseJsonSchema } : {}) },
  };

  const res = await withRetry(() => ai().models.generateContent(req));
  const u = res.usageMetadata ?? {};
  record(model, ctx, u.promptTokenCount ?? 0, (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0));

  let json: unknown;
  try {
    json = JSON.parse(stripFence(res.text ?? ""));
  } catch {
    throw new Error(`[${ctx.purpose}] model returned non-JSON output: ${(res.text ?? "").slice(0, 200)}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`[${ctx.purpose}] model output failed schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

// ---------- decide ----------

export interface DecisionQuestion {
  id: string;
  text: string;
  /** "noul" (yes/no) questions return one probability; "choice" questions one per option. */
  kind: "noul" | "choice";
  options?: string[];
  /** Optional description per choice option (defaults to the option id). */
  optionDescriptions?: Record<string, string>;
}

const QuestionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    kind: z.enum(["noul", "choice"]),
    options: z.array(z.string().trim().min(1)).max(255).optional(),
    optionDescriptions: z.record(z.string(), z.string()).optional(),
  })
  .refine((q) => q.kind === "noul" || (q.options !== undefined && q.options.length >= 2), {
    message: "choice questions need at least 2 options",
  });

const DecisionResponseSchema = z.object({
  answers: z
    .record(
      z.string(),
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
        z.object({ type: z.literal("choice"), probabilities: z.record(z.string(), z.number().min(0).max(1)) }),
        z.object({ type: z.literal("score") }),
      ]),
    )
    .optional(),
  usage: z
    .object({ total_input_tokens: z.number().optional(), total_output_tokens: z.number().optional() })
    .optional(),
});

function toDecisionInput(p: Part): DecisionInput {
  if (p.kind === "text") return { type: "text", text: p.text };
  const family = p.mimeType.split("/")[0];
  if (family !== "image" && family !== "video" && family !== "audio") {
    throw new Error(`unsupported media type for decisions: ${p.mimeType}`);
  }
  return { type: family, mime_type: p.mimeType, data: p.data };
}

/** Decisions API: scores many yes/no or multiple-choice questions about the same input. */
export async function decide(
  parts: unknown[],
  questions: DecisionQuestion[],
  ctx: CallContext,
): Promise<Record<string, number | Record<string, number>>> {
  const input = PartsSchema.parse(parts).map(toDecisionInput);
  const qs = z.array(QuestionSchema).min(1).parse(questions);
  const ids = new Set<string>();
  for (const q of qs) {
    if (ids.has(q.id)) throw new Error(`duplicate question id: ${q.id}`);
    ids.add(q.id);
  }

  const model = MODELS.DECIDE.startsWith("models/") ? MODELS.DECIDE : `models/${MODELS.DECIDE}`;
  const req: DecisionRequest = {
    // The SDK's default version (v1) has no Decisions endpoint and answers with a bare 404.
    api_version: process.env.DECISIONS_API_VERSION ?? "v1beta",
    model,
    input,
    // The API only accepts ids matching [A-Za-z0-9_-]{1,64}; callers' ids are mapped to q0, q1, ...
    questions: Object.fromEntries(
      qs.map((q, i): [string, DecisionQuestionWire] => [
        `q${i}`,
        q.kind === "noul"
          ? { type: "noul", instructions: q.text }
          : { type: "choice", instructions: q.text, criteria: Object.fromEntries(q.options!.map((o) => [o, q.optionDescriptions?.[o] ?? o])) },
      ]),
    ),
  };

  const res = DecisionResponseSchema.parse(await withRetry(() => ai().decisions.create(req)));
  record(MODELS.DECIDE, ctx, res.usage?.total_input_tokens ?? 0, res.usage?.total_output_tokens ?? 0);

  const out: Record<string, number | Record<string, number>> = {};
  for (const [i, q] of qs.entries()) {
    const a = res.answers?.[`q${i}`];
    if (!a || a.type !== q.kind) throw new Error(`[${ctx.purpose}] decision answer missing or wrong type for ${q.id}`);
    out[q.id] = a.type === "noul" ? a.noul : (a as { probabilities: Record<string, number> }).probabilities;
  }
  return out;
}
