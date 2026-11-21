// OWNER: Dev 1.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  __resetTestHooks,
  __setTestHooks,
  clientStats,
  decide,
  estimateUsd,
  generateJson,
  logCost,
  mediaPart,
  textPart,
  type GenAILike,
} from "@/lib/gemini/client";
import { MODELS } from "@/lib/config";
import type { CostRecord } from "@/lib/types";

let dir: string;
let costLogPath: string;

function fakeAi(overrides: Partial<{ generateContent: GenAILike["models"]["generateContent"]; create: GenAILike["decisions"]["create"] }> = {}) {
  const generateContent = vi.fn<GenAILike["models"]["generateContent"]>(
    overrides.generateContent ??
      (async () => ({ text: '{"ok":true}', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } })),
  );
  const create = vi.fn<GenAILike["decisions"]["create"]>(
    overrides.create ??
      (async () => ({ answers: {}, usage: { total_input_tokens: 0, total_output_tokens: 0 } })),
  );
  const ai: GenAILike = { models: { generateContent }, decisions: { create } };
  return { ai, generateContent, create };
}

function readCosts(): CostRecord[] {
  return readFileSync(costLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as CostRecord);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rashomon-client-"));
  costLogPath = path.join(dir, "logs", "costs.jsonl");
  __setTestHooks({ costLogPath, sleep: async () => {} });
});

afterEach(() => {
  __resetTestHooks();
  rmSync(dir, { recursive: true, force: true });
});

describe("parts", () => {
  it("builds text and media parts", () => {
    expect(textPart("hi")).toEqual({ kind: "text", text: "hi" });
    expect(mediaPart("AAAA", "video/mp4")).toEqual({ kind: "media", mimeType: "video/mp4", data: "AAAA" });
  });
});

describe("estimateUsd", () => {
  it("prices input and output tokens per million", () => {
    const usd = estimateUsd("unknown-model", 1_000_000, 1_000_000);
    expect(usd).toBeGreaterThan(0);
    expect(estimateUsd("unknown-model", 0, 0)).toBe(0);
    expect(estimateUsd("unknown-model", 2_000_000, 0)).toBeCloseTo(2 * estimateUsd("unknown-model", 1_000_000, 0));
  });
});

describe("logCost", () => {
  it("appends one JSON line per record, creating the folder", () => {
    const rec: CostRecord = { at: "t", model: "m", purpose: "p", inputTokens: 1, outputTokens: 2, usd: 0.1 };
    logCost(rec);
    logCost({ ...rec, purpose: "q" });
    expect(readCosts().map((r) => r.purpose)).toEqual(["p", "q"]);
  });
});

describe("generateJson", () => {
  const schema = z.object({ ok: z.boolean() });

  it("sends converted parts, parses with zod and logs cost", async () => {
    const { ai, generateContent } = fakeAi();
    __setTestHooks({ ai });
    const out = await generateJson("gemini-x", [textPart("q"), mediaPart("QUJD", "image/jpeg")], schema, {
      purpose: "scout",
      sceneId: "s1",
    });
    expect(out).toEqual({ ok: true });
    const req = generateContent.mock.calls[0]![0];
    expect(req.model).toBe("gemini-x");
    expect(req.contents).toEqual([
      { role: "user", parts: [{ text: "q" }, { inlineData: { mimeType: "image/jpeg", data: "QUJD" } }] },
    ]);
    expect(req.config?.responseMimeType).toBe("application/json");
    const [cost] = readCosts();
    expect(cost).toMatchObject({ model: "gemini-x", purpose: "scout", sceneId: "s1", inputTokens: 100, outputTokens: 10 });
    expect(cost!.usd).toBeGreaterThan(0);
  });

  it("also accepts the SDK's own { text } and { inlineData } parts", async () => {
    const { ai, generateContent } = fakeAi();
    __setTestHooks({ ai });
    await generateJson("m", [{ text: "q" }, { inlineData: { mimeType: "image/png", data: "QQ==" } }], schema, { purpose: "t" });
    expect(generateContent.mock.calls[0]![0].contents[0]!.parts).toEqual([
      { text: "q" },
      { inlineData: { mimeType: "image/png", data: "QQ==" } },
    ]);
  });

  it("strips a markdown code fence around the JSON", async () => {
    const { ai } = fakeAi({ generateContent: async () => ({ text: '```json\n{"ok":false}\n```' }) });
    __setTestHooks({ ai });
    await expect(generateJson("m", [textPart("q")], schema, { purpose: "t" })).resolves.toEqual({ ok: false });
  });

  it("throws when the output fails the schema", async () => {
    const { ai } = fakeAi({ generateContent: async () => ({ text: '{"ok":"yes"}' }) });
    __setTestHooks({ ai });
    await expect(generateJson("m", [textPart("q")], schema, { purpose: "t" })).rejects.toThrow(/schema/i);
  });

  it("rejects malformed parts", async () => {
    __setTestHooks({ ai: fakeAi().ai });
    await expect(generateJson("m", [{ foo: 1 }] as never, schema, { purpose: "t" })).rejects.toThrow();
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    let n = 0;
    const { ai, generateContent } = fakeAi({
      generateContent: async () => {
        n++;
        if (n === 1) throw Object.assign(new Error("rate"), { status: 429 });
        if (n === 2) throw Object.assign(new Error("boom"), { status: 503 });
        return { text: '{"ok":true}' };
      },
    });
    __setTestHooks({ ai });
    await expect(generateJson("m", [textPart("q")], schema, { purpose: "t" })).resolves.toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(clientStats()).toEqual({ calls: 3, retries: 2, rateLimited: 1, failures: 0 });
  });

  it("does not retry client errors", async () => {
    const { ai, generateContent } = fakeAi({
      generateContent: async () => {
        throw Object.assign(new Error("bad request"), { status: 400 });
      },
    });
    __setTestHooks({ ai });
    await expect(generateJson("m", [textPart("q")], schema, { purpose: "t" })).rejects.toThrow("bad request");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("gives up after the maximum attempts", async () => {
    const { ai, generateContent } = fakeAi({
      generateContent: async () => {
        throw Object.assign(new Error("rate"), { status: 429 });
      },
    });
    __setTestHooks({ ai, maxAttempts: 3 });
    await expect(generateJson("m", [textPart("q")], schema, { purpose: "t" })).rejects.toThrow("rate");
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("never runs more than maxConcurrent calls at once", async () => {
    let active = 0;
    let peak = 0;
    const { ai } = fakeAi({
      generateContent: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { text: '{"ok":true}' };
      },
    });
    __setTestHooks({ ai, maxConcurrent: 2 });
    await Promise.all(Array.from({ length: 6 }, () => generateJson("m", [textPart("q")], schema, { purpose: "t" })));
    expect(peak).toBe(2);
  });
});

describe("decide", () => {
  it("maps questions to the Decisions API and returns probabilities", async () => {
    const { ai, create } = fakeAi({
      create: async () => ({
        answers: {
          q0: { type: "noul", noul: 0.83, confidence: 0.83 },
          q1: { type: "choice", choice: "C", confidence: 0.7, probabilities: { C: 0.7, D: 0.3 } },
        },
        usage: { total_input_tokens: 500, total_output_tokens: 4 },
      }),
    });
    __setTestHooks({ ai });
    const out = await decide(
      [mediaPart("VklE", "video/mp4"), textPart("context")],
      [
        { id: "red_cup:location:C", text: "Is the red cup in zone C?", kind: "noul" },
        { id: "q2", text: "Which zone is the cup in?", kind: "choice", options: ["C", "D"] },
      ],
      { purpose: "lattice", sceneId: "s1" },
    );
    expect(out).toEqual({ "red_cup:location:C": 0.83, q2: { C: 0.7, D: 0.3 } });

    const req = create.mock.calls[0]![0];
    expect(req.model).toBe(`models/${MODELS.DECIDE}`);
    expect(req.api_version).toBe("v1beta");
    expect(req.input).toEqual([
      { type: "video", mime_type: "video/mp4", data: "VklE" },
      { type: "text", text: "context" },
    ]);
    expect(Object.keys(req.questions).every((k) => /^[A-Za-z0-9_-]{1,64}$/.test(k))).toBe(true);
    expect(req.questions.q0).toMatchObject({ type: "noul", instructions: "Is the red cup in zone C?" });
    expect(req.questions.q1).toMatchObject({ type: "choice", instructions: "Which zone is the cup in?" });
    expect(Object.keys((req.questions.q1 as { criteria: object }).criteria)).toEqual(["C", "D"]);

    expect(readCosts()[0]).toMatchObject({ purpose: "lattice", inputTokens: 500, outputTokens: 4, model: MODELS.DECIDE });
  });

  it("uses option descriptions as choice criteria", async () => {
    const { ai, create } = fakeAi({
      create: async () => ({ answers: { q0: { type: "choice", probabilities: { a: 0.9, none: 0.1 } } } }),
    });
    __setTestHooks({ ai });
    await decide(
      [textPart("x")],
      [{ id: "q", text: "Which?", kind: "choice", options: ["a", "none"], optionDescriptions: { a: "red cup" } }],
      { purpose: "t" },
    );
    expect((create.mock.calls[0]![0].questions.q0 as { criteria: object }).criteria).toEqual({ a: "red cup", none: "none" });
  });

  it("throws when an answer is missing", async () => {
    const { ai } = fakeAi({ create: async () => ({ answers: {} }) });
    __setTestHooks({ ai });
    await expect(decide([textPart("x")], [{ id: "q1", text: "?", kind: "noul" }], { purpose: "t" })).rejects.toThrow(
      /q1/,
    );
  });

  it("validates questions before calling the API", async () => {
    const { ai, create } = fakeAi();
    __setTestHooks({ ai });
    await expect(
      decide([textPart("x")], [{ id: "q", text: "?", kind: "choice", options: ["only"] }], { purpose: "t" }),
    ).rejects.toThrow();
    await expect(
      decide(
        [textPart("x")],
        [
          { id: "q", text: "?", kind: "noul" },
          { id: "q", text: "?", kind: "noul" },
        ],
        { purpose: "t" },
      ),
    ).rejects.toThrow(/duplicate/i);
    expect(create).not.toHaveBeenCalled();
  });
});
