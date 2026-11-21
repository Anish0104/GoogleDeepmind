// OWNER: Dev 3. Tests for the @google/genai stand-in adapter with a fake client. No real API calls.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FunctionCallingConfigMode, Type, type GenerateContentParameters } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS } from "@/lib/config";
import { InspectWindowArgsSchema, StopArgsSchema } from "@/lib/agent/bridge";
import type { CostRecord } from "@/lib/types";

type Mod = typeof import("@/lib/agent/genai-turn");
let mod: Mod;
let dir: string;
let log: string;
const ENV_KEYS = [
  "STANDIN_MODEL",
  "STANDIN_PRICE_IN",
  "STANDIN_PRICE_OUT",
  "GEMINI_API_KEY",
] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

beforeEach(async () => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  dir = await mkdtemp(path.join(tmpdir(), "rashomon-genai-"));
  log = path.join(dir, "logs", "costs.jsonl");
  vi.resetModules(); // fresh one-time price warning per test
  mod = await import("@/lib/agent/genai-turn");
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const readLog = async (): Promise<CostRecord[]> =>
  (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as CostRecord);

interface FakeClient {
  generateContent: (p: GenerateContentParameters) => Promise<{
    functionCalls?: { name?: string; args?: Record<string, unknown> }[];
    text?: string;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  }>;
}

type FakeResponse = Awaited<ReturnType<FakeClient["generateContent"]>>;

function fakeClient(response: FakeResponse) {
  const calls: GenerateContentParameters[] = [];
  const client: FakeClient = {
    generateContent: vi.fn(async (p: GenerateContentParameters) => {
      calls.push(p);
      return response;
    }),
  };
  return { client, calls };
}

const req = { systemInstruction: "SYS PROMPT", userText: "MENU JSON", sceneId: "s1" };
const usage = { promptTokenCount: 1_000, candidatesTokenCount: 200, thoughtsTokenCount: 50 };

describe("function declarations", () => {
  it("declares exactly inspect_window and stop", () => {
    expect(mod.FUNCTION_DECLARATIONS.map((d) => d.name)).toEqual(["inspect_window", "stop"]);
  });

  it.each([
    ["inspect_window", InspectWindowArgsSchema],
    ["stop", StopArgsSchema],
  ] as const)("%s mirrors its zod schema", (name, schema) => {
    const decl = mod.FUNCTION_DECLARATIONS.find((d) => d.name === name);
    const keys = Object.keys(schema.shape).sort();
    expect(decl?.parameters?.type).toBe(Type.OBJECT);
    expect(Object.keys(decl?.parameters?.properties ?? {}).sort()).toEqual(keys);
    expect([...(decl?.parameters?.required ?? [])].sort()).toEqual(keys);
    for (const p of Object.values(decl?.parameters?.properties ?? {})) expect(p.description).toBeTruthy();
  });

  it("uses the same enums and lower bounds as the zod schema", () => {
    const props = mod.INSPECT_WINDOW_DECLARATION.parameters?.properties ?? {};
    expect(props.camera_id).toMatchObject({ type: Type.STRING, enum: InspectWindowArgsSchema.shape.camera_id.options });
    expect(props.crop).toMatchObject({ type: Type.STRING, enum: InspectWindowArgsSchema.shape.crop.options });
    expect(props.start_s).toMatchObject({ type: Type.NUMBER, minimum: 0 });
    expect(props.end_s).toMatchObject({ type: Type.NUMBER, minimum: 0 });
    expect(props.reason).toMatchObject({ type: Type.STRING });
  });
});

describe("standinModelName", () => {
  it("uses STANDIN_MODEL, falling back to MODELS.SCOUT", () => {
    expect(mod.standinModelName()).toBe(MODELS.SCOUT);
    process.env.STANDIN_MODEL = "";
    expect(mod.standinModelName()).toBe(MODELS.SCOUT);
    process.env.STANDIN_MODEL = "gemini-test-model";
    expect(mod.standinModelName()).toBe("gemini-test-model");
  });
});

describe("standinUsd", () => {
  it("prices tokens per million from env", () => {
    process.env.STANDIN_PRICE_IN = "0.5";
    process.env.STANDIN_PRICE_OUT = "2";
    expect(mod.standinUsd(1_000_000, 250_000)).toBeCloseTo(0.5 + 0.5, 10);
  });

  it("returns 0 with a single warning when prices are unset or invalid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(mod.standinUsd(1000, 1000)).toBe(0);
    process.env.STANDIN_PRICE_IN = "abc";
    process.env.STANDIN_PRICE_OUT = "-1";
    expect(mod.standinUsd(1000, 1000)).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/STANDIN_PRICE_IN.*STANDIN_PRICE_OUT/);
  });
});

describe("appendCostRecord", () => {
  it("creates the log folder and appends one JSON line per record", async () => {
    const r: CostRecord = { at: "t", model: "m", purpose: "standin", inputTokens: 1, outputTokens: 2, usd: 0 };
    await mod.appendCostRecord(r, log);
    await mod.appendCostRecord({ ...r, usd: 1 }, log);
    expect(await readLog()).toEqual([r, { ...r, usd: 1 }]);
  });
});

describe("createGenaiModel", () => {
  it("sends one request with the system prompt, both tools and forced function calling", async () => {
    process.env.STANDIN_MODEL = "gemini-test-model";
    const { client, calls } = fakeClient({ functionCalls: [{ name: "stop", args: { reason: "x" } }], usageMetadata: usage });
    await mod.createGenaiModel({ client, logPath: log }).generate(req);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      model: "gemini-test-model",
      contents: "MENU JSON",
      config: {
        systemInstruction: "SYS PROMPT",
        tools: [{ functionDeclarations: mod.FUNCTION_DECLARATIONS }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: ["inspect_window", "stop"],
          },
        },
      },
    });
  });

  it("returns the first function call, token counts and cost, and logs a CostRecord", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.STANDIN_PRICE_IN = "1";
    process.env.STANDIN_PRICE_OUT = "4";
    const { client } = fakeClient({
      functionCalls: [
        { name: "inspect_window", args: { camera_id: "B", start_s: 1, end_s: 3, crop: "full", reason: "r" } },
        { name: "stop", args: { reason: "ignored" } },
      ],
      usageMetadata: usage,
    });
    const now = () => new Date("2026-11-21T17:00:00.000Z");
    const reply = await mod.createGenaiModel({ client, logPath: log, model: "m1", now }).generate(req);

    const usd = (1_000 * 1 + 250 * 4) / 1_000_000; // thoughts count as output
    expect(reply).toEqual({
      call: { name: "inspect_window", args: { camera_id: "B", start_s: 1, end_s: 3, crop: "full", reason: "r" } },
      text: null,
      inputTokens: 1_000,
      outputTokens: 250,
      costUsd: usd,
    });
    expect(await readLog()).toEqual([
      {
        at: "2026-11-21T17:00:00.000Z",
        model: "m1",
        purpose: "standin",
        inputTokens: 1_000,
        outputTokens: 250,
        usd,
        sceneId: "s1",
      },
    ]);
  });

  it("returns text and no call when the model answers in prose", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = fakeClient({ text: "It was supported.", usageMetadata: usage });
    const reply = await mod.createGenaiModel({ client, logPath: log }).generate(req);
    expect(reply).toMatchObject({ call: null, text: "It was supported." });
    expect(await readLog()).toHaveLength(1); // the call still cost tokens
  });

  it("treats a function call with no name as no call", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = fakeClient({ functionCalls: [{ args: {} }] });
    const reply = await mod.createGenaiModel({ client, logPath: log }).generate(req);
    expect(reply).toMatchObject({ call: null, inputTokens: 0, outputTokens: 0 });
  });

  it("defaults missing args to {} so zod reports the missing fields", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = fakeClient({ functionCalls: [{ name: "stop" }] });
    const reply = await mod.createGenaiModel({ client, logPath: log }).generate(req);
    expect(reply.call).toEqual({ name: "stop", args: {} });
  });

  it("needs GEMINI_API_KEY when no client is injected", () => {
    expect(() => mod.createGenaiModel({ logPath: log })).toThrow(/GEMINI_API_KEY/);
  });
});
