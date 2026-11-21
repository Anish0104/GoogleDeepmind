// OWNER: Dev 3. Real StandinModel: one @google/genai generateContent call with function calling.
// Exactly two function declarations (inspect_window, stop), mirroring InspectWindowArgsSchema and
// StopArgsSchema in bridge.ts (a test keeps them in sync). Field names checked against @google/genai 3.6.1.
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  Type,
  type FunctionCall,
  type FunctionDeclaration,
  type GenerateContentParameters,
  type GenerateContentResponseUsageMetadata,
} from "@google/genai";
import { COST_LOG, MODELS } from "@/lib/config";
import type { CostRecord } from "@/lib/types";
import type { ModelReply, ModelRequest, StandinModel } from "@/lib/agent/standin";

// ---------- function declarations ----------

export const INSPECT_WINDOW_DECLARATION: FunctionDeclaration = {
  name: "inspect_window",
  description:
    "Check one short clip from one camera. Use only a camera in includedCameras and a window inside " +
    "allowedRangeS that is 1-4 s long and does not overlap alreadyChecked on that camera.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      camera_id: { type: Type.STRING, enum: ["A", "B", "C", "D"], description: "Camera to check." },
      start_s: { type: Type.NUMBER, minimum: 0, description: "Clip start, seconds from scene start." },
      end_s: { type: Type.NUMBER, minimum: 0, description: "Clip end, seconds from scene start." },
      crop: {
        type: Type.STRING,
        enum: ["full", "entity"],
        description: "full frame, or cropped to the claim's object.",
      },
      reason: { type: Type.STRING, description: "One sentence: why this clip could settle or break the label." },
    },
    required: ["camera_id", "start_s", "end_s", "crop", "reason"],
  },
};

export const STOP_DECLARATION: FunctionDeclaration = {
  name: "stop",
  description: "Stop when no allowed clip could change the result.",
  parameters: {
    type: Type.OBJECT,
    properties: { reason: { type: Type.STRING, description: "One sentence: why you are stopping." } },
    required: ["reason"],
  },
};

export const FUNCTION_DECLARATIONS: FunctionDeclaration[] = [INSPECT_WINDOW_DECLARATION, STOP_DECLARATION];
const FUNCTION_NAMES = FUNCTION_DECLARATIONS.map((d) => d.name ?? "");

// ---------- model name and cost ----------

/** STANDIN_MODEL, or MODELS.SCOUT when unset or empty. Read at call time. */
export function standinModelName(): string {
  return process.env.STANDIN_MODEL || MODELS.SCOUT;
}

let warnedNoPrices = false;

const price = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** USD for a call from per-million-token prices in STANDIN_PRICE_IN / STANDIN_PRICE_OUT. 0 (warned once) if unset. */
export function standinUsd(inputTokens: number, outputTokens: number): number {
  const pin = price(process.env.STANDIN_PRICE_IN);
  const pout = price(process.env.STANDIN_PRICE_OUT);
  if (pin === null || pout === null) {
    if (!warnedNoPrices) {
      warnedNoPrices = true;
      console.warn(
        "[standin] STANDIN_PRICE_IN / STANDIN_PRICE_OUT are unset or invalid: logging stand-in calls as $0. " +
          "The budget meter will undercount until they are set.",
      );
    }
    return 0;
  }
  return (inputTokens * pin + outputTokens * pout) / 1_000_000;
}

// TODO: switch to lib/gemini/client.ts once Dev 1 ships it.
/** Appends one CostRecord to the JSONL cost log (COST_LOG by default), creating the folder if needed. */
export async function appendCostRecord(record: CostRecord, logPath: string = COST_LOG): Promise<void> {
  const file = path.resolve(logPath);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(record) + "\n", "utf8");
}

// ---------- adapter ----------

/** The part of GoogleGenAI.models this adapter uses; tests inject a fake. */
export interface GenaiClient {
  generateContent(params: GenerateContentParameters): Promise<{
    functionCalls?: FunctionCall[];
    text?: string;
    usageMetadata?: Pick<
      GenerateContentResponseUsageMetadata,
      "promptTokenCount" | "candidatesTokenCount" | "thoughtsTokenCount"
    >;
  }>;
}

export interface GenaiModelOptions {
  client?: GenaiClient;
  apiKey?: string;
  /** Defaults to standinModelName() at each call. */
  model?: string;
  logPath?: string;
  now?: () => Date;
}

/** A StandinModel backed by @google/genai. Each generate() is one API call, logged to the cost log. */
export function createGenaiModel(opts: GenaiModelOptions = {}): StandinModel {
  let client = opts.client;
  if (!client) {
    const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set: add it to .env.local to use the stand-in agent.");
    client = new GoogleGenAI({ apiKey }).models;
  }
  const api = client;
  const now = opts.now ?? (() => new Date());

  return {
    async generate(req: ModelRequest): Promise<ModelReply> {
      const model = opts.model ?? standinModelName();
      const params: GenerateContentParameters = {
        model,
        contents: req.userText,
        config: {
          systemInstruction: req.systemInstruction,
          tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
          toolConfig: {
            functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: FUNCTION_NAMES },
          },
        },
      };
      const res = await api.generateContent(params);

      const u = res.usageMetadata;
      const inputTokens = u?.promptTokenCount ?? 0;
      const outputTokens = (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0); // thinking bills as output
      const costUsd = standinUsd(inputTokens, outputTokens);
      await appendCostRecord(
        {
          at: now().toISOString(),
          model,
          purpose: "standin",
          inputTokens,
          outputTokens,
          usd: costUsd,
          ...(req.sceneId ? { sceneId: req.sceneId } : {}),
        },
        opts.logPath,
      );

      const first = res.functionCalls?.[0];
      const call = first?.name ? { name: first.name, args: first.args ?? {} } : null;
      // Only read .text when there is no call: the SDK warns when .text is read on a function-call reply.
      const text = call ? null : (res.text ?? null);
      return { call, text, inputTokens, outputTokens, costUsd };
    },
  };
}
