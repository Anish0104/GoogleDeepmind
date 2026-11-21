// OWNER: Dev 2. Regression tests for the model-facing response schemas sent to Gemini.
// Live finding (gemini-4-carbon): schemas with unconstrained items or nested array/string bounds are
// rejected with HTTP 400 "too many states for serving". These tests keep the model-facing schemas
// simple, and prove the strict app-side validation still rejects everything it rejected before.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));

import { z } from "zod";
import { generateJson } from "@/lib/gemini/client";
import { LIMITS } from "@/lib/config";
import { ClaimsResponseSchema, parseClaimsResponse, splitClaims, wireToRaw, type ClaimWire, type RawClaim } from "@/lib/truth/claims";
import { ClaimExtractionError } from "@/lib/truth/errors";
import { JudgeResponseSchema, JudgeStrictSchema, buildProvenance, judge } from "@/lib/truth/judge";
import type { CameraId, Event, GridRow } from "@/lib/types";

const gen = vi.mocked(generateJson);
beforeEach(() => gen.mockReset());

// ---------- JSON-schema shape ----------

const FORBIDDEN = ["maxItems", "minItems", "maxLength", "minLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "pattern", "format", "prefixItems"];

type Json = Record<string, unknown>;
/** Every problem in a JSON schema that Gemini's constrained decoder is known to choke on. */
function problems(node: unknown, path = "$"): string[] {
  if (typeof node !== "object" || node === null) return [];
  const n = node as Json;
  const out: string[] = [];
  for (const k of FORBIDDEN) if (k in n) out.push(`${path}.${k}`);
  if (n.type === "array") {
    const items = n.items as Json | undefined;
    if (!items || Object.keys(items).length === 0) out.push(`${path}.items is unconstrained`);
  }
  if (n.type === "object" && (!n.properties || Object.keys(n.properties as Json).length === 0)) out.push(`${path} has no properties`);
  for (const [k, v] of Object.entries(n)) {
    if (Array.isArray(v)) v.forEach((x, i) => out.push(...problems(x, `${path}.${k}[${i}]`)));
    else if (typeof v === "object") out.push(...problems(v, `${path}.${k}`));
  }
  return out;
}

const props = (s: Json) => s.properties as Record<string, Json>;

describe("model-facing JSON schemas", () => {
  const claims = z.toJSONSchema(ClaimsResponseSchema) as Json;
  const judgeS = z.toJSONSchema(JudgeResponseSchema) as Json;

  it("both convert to structured JSON schemas", () => {
    expect(claims.type).toBe("object");
    expect(judgeS.type).toBe("object");
  });

  it("contain no length/number bounds and no unconstrained items", () => {
    expect(problems(claims)).toEqual([]);
    expect(problems(judgeS)).toEqual([]);
  });

  it("the old schemas would have failed this check (guards the test itself)", () => {
    expect(problems(z.toJSONSchema(JudgeStrictSchema))).not.toEqual([]);
    expect(problems(z.toJSONSchema(z.object({ claims: z.array(z.unknown()).max(50) })))).not.toEqual([]);
  });

  it("claims: every expected field is explicitly defined, core fields required", () => {
    const item = props(claims).claims!.items as Json;
    expect(Object.keys(props(item)).sort()).toEqual(
      ["actionKind", "actor", "anchor", "end", "hedged", "object", "offsetS", "recipient", "relation", "start", "stateValue", "t", "text", "timeKind", "times", "verb", "zone"].sort(),
    );
    expect((item.required as string[]).sort()).toEqual(["actionKind", "actor", "hedged", "object", "text", "timeKind"]);
    expect(props(item).actionKind!.enum).toEqual(["move", "located", "take", "give", "state", "other"]);
    expect(props(item).timeKind!.enum).toEqual(["exact", "approx", "range", "relative", "conflicting", "none"]);
    expect(JSON.stringify(item)).not.toMatch(/anyOf|oneOf|allOf/);
  });

  it("judge: sentence and citation fields are explicitly defined and required", () => {
    const sentence = props(judgeS).sentences!.items as Json;
    expect((sentence.required as string[]).sort()).toEqual(["citations", "eventIds", "text"]);
    const citation = props(sentence).citations!.items as Json;
    expect((citation.required as string[]).sort()).toEqual(["camera", "window"]);
    expect(props(citation).camera!.enum).toEqual(["A", "B", "C", "D"]);
  });
});

// ---------- claims: wire form -> strict validation ----------

const TRANSCRIPT = "At 00:04 Sam picked up the mug. At 00:09 Sam moved the mug into zone C. At 00:14 Sam handed the mug to Ana.";
const wire = (o: Partial<ClaimWire> = {}): ClaimWire => ({
  text: "Sam moved the mug into zone C",
  actor: "Sam",
  object: "mug",
  actionKind: "move",
  zone: "C",
  timeKind: "exact",
  t: 9,
  hedged: false,
  ...o,
});
const nested: RawClaim = {
  text: "Sam moved the mug into zone C",
  actor: "Sam",
  object: "mug",
  action: { kind: "move", zone: "C" },
  time: { kind: "exact", t: 9 },
  hedged: false,
};
const parse = (items: unknown[]) => parseClaimsResponse({ claims: items }, TRANSCRIPT, "s1");

describe("claims: wire form", () => {
  it("a flat wire claim produces exactly the same Claim and id as its nested equivalent", () => {
    const a = parse([wire()]);
    const b = parse([nested]);
    expect(a.rejected).toEqual([]);
    expect(a.claims).toEqual(b.claims);
    expect(a.claims[0]).toMatchObject({ action: "move to zone C", window: [8, 11], timeIsPrecise: true });
  });

  it("maps every action and time kind", () => {
    const r = parse([
      wire({ text: "Sam picked up the mug", actionKind: "take", zone: undefined, timeKind: "approx", t: 4 }),
      wire({ text: "Sam handed the mug to Ana", actionKind: "give", zone: undefined, recipient: "Ana", timeKind: "range", t: undefined, start: 13, end: 15 }),
      wire({ timeKind: "relative", t: undefined, relation: "after", anchor: 0, offsetS: 5 }),
      wire({ timeKind: "conflicting", t: undefined, times: [9, 14] }),
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.claims.map((c) => c.action)).toEqual(["pick up", "give to ana", "move to zone C", "move to zone C"]);
  });

  it("treats null and empty-string optional fields as absent", () => {
    const r = parse([{ ...wire({ actionKind: "take", text: "Sam picked up the mug" }), zone: "", recipient: null, verb: null, times: [] }]);
    expect(r.rejected).toEqual([]);
  });

  const bad: [string, unknown, RegExp][] = [
    ["a field for another action kind", wire({ actionKind: "take", text: "Sam picked up the mug" }), /zone.*not allowed.*take/],
    ["a field for another time kind", wire({ start: 3 }), /start.*not allowed.*exact/],
    ["missing required kind field", wire({ zone: undefined }), /malformed/],
    ["missing time value", wire({ t: undefined }), /malformed/],
    ["unknown actionKind", wire({ actionKind: "teleport" as never }), /actionKind/],
    ["unknown timeKind", wire({ timeKind: "soon" as never }), /timeKind/],
    ["NaN time", wire({ t: Number.NaN }), /malformed/],
    ["negative time", wire({ t: -1 }), /malformed/],
    ["non-integer anchor", wire({ timeKind: "relative", t: undefined, relation: "after", anchor: 0.5 }), /malformed/],
    ["too many conflicting times", wire({ timeKind: "conflicting", t: undefined, times: [1, 2, 3, 4, 5, 6] }), /malformed/],
    ["blank text", wire({ text: "   " }), /malformed/],
    ["overlong text", wire({ text: "x".repeat(301) }), /malformed/],
    ["wrong type", wire({ hedged: "no" as never }), /malformed/],
  ];

  it.each(bad)("still rejects %s", (_n, item, re) => {
    const r = parse([item]);
    expect(r.claims).toEqual([]);
    expect(r.rejected[0]!.reason).toMatch(re);
  });

  it("still applies fidelity rules to wire claims", () => {
    expect(parse([wire({ actor: "Detective Smith" })]).rejected[0]!.reason).toMatch(/actor/);
    expect(parse([wire({ zone: "E", text: "Sam moved the mug into zone E" })]).rejected[0]!.reason).toMatch(/zone/);
  });

  it("still caps the number of claims", () => {
    expect(() => parse(Array.from({ length: 51 }, () => wire()))).toThrow(ClaimExtractionError);
  });

  it("wireToRaw passes non-wire items through for nested validation", () => {
    expect(wireToRaw(nested)).toEqual({ raw: nested });
  });

  it("splitClaims sends the model-facing schema and accepts a wire response", async () => {
    gen.mockResolvedValueOnce({ claims: [wire()] } as never);
    const claims = await splitClaims(TRANSCRIPT, "s1");
    expect(gen.mock.calls[0]![2]).toBe(ClaimsResponseSchema);
    expect(claims).toEqual(parse([nested]).claims);
  });
});

// ---------- judge: model-facing schema, strict envelope ----------

function rows(camera: CameraId, t0: number, t1: number, pVisible = 0.95): GridRow[] {
  const out: GridRow[] = [];
  for (let t = t0; t < t1 - 1e-9; t += LIMITS.SLICE_S) out.push({ sceneId: "s1", camera, t, questionId: "q", pYes: 0.5, pVisible });
  return out;
}
const ROWS = [...rows("A", 0, 12), ...rows("B", 0, 12)];
const E1: Event = { entityId: "e1", from: "B", to: "C", t: 6, confidence: 0.95, cameras: ["A", "B"] };
const GOOD = { text: "e1 moved from zone B to zone C at about 6 s.", eventIds: ["E1"], citations: [{ camera: "A", window: [5, 7.5] }] };

describe("judge: strict envelope still applies", () => {
  it("passes the model-facing schema to generateJson", async () => {
    gen.mockResolvedValueOnce({ sentences: [GOOD] } as never);
    await judge("What happened?", [E1], ROWS);
    expect(gen.mock.calls[0]![2]).toBe(JudgeResponseSchema);
  });

  it("an over-cap response is rejected app-side and retried", async () => {
    gen.mockResolvedValueOnce({ sentences: Array.from({ length: 21 }, () => GOOD) } as never);
    gen.mockResolvedValueOnce({ sentences: [GOOD] } as never);
    expect(await judge("What happened?", [E1], ROWS)).toHaveLength(1);
    expect(gen).toHaveBeenCalledTimes(2);
  });

  it("extra keys and overlong text are rejected app-side", () => {
    expect(JudgeStrictSchema.safeParse({ sentences: [], note: "x" }).success).toBe(false);
    expect(JudgeStrictSchema.safeParse({ sentences: [{ ...GOOD, text: "x".repeat(401) }] }).success).toBe(false);
  });

  it("citation provenance is unchanged: valid citations pass, fabricated ones are dropped", async () => {
    const p = buildProvenance([E1], ROWS);
    expect(p.facts[0]!.citable).toEqual([
      { camera: "A", window: [5, 7.5] },
      { camera: "B", window: [5, 7.5] },
    ]);
    const fake = { ...GOOD, text: "e1 moved from zone B to zone C at about 6 s, seen by D.", citations: [{ camera: "D", window: [5, 7] }] };
    for (let i = 0; i < 3; i++) gen.mockResolvedValueOnce({ sentences: [GOOD, fake] } as never);
    const out = await judge("What happened?", [E1], ROWS);
    expect(out).toEqual([{ text: GOOD.text, citations: [{ camera: "A", window: [5, 7.5] }] }]);
  });
});
