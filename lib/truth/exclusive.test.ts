// OWNER: Dev 2. Exclusive-state pairs: validation against the scene, grounding alternatives, and the
// negation / temporal-ordering guard. PAIRS is a HYPOTHETICAL TEST FIXTURE (the pairs Dev 1 once proposed
// in be0d5fb and then removed in 0671f3d as unsafe); production reads only Dev 1's registered export.
import { describe, expect, it } from "vitest";
import { registeredExclusivePairs, validExclusivePairs } from "@/lib/truth/exclusive";
import { resolveGrounding } from "@/lib/truth/grounding";
import { QUESTION_SET_EXCLUSIVE } from "@/lib/perception/questionSets";
import type { Claim, Question } from "@/lib/types";

const q = (entityId: string, predicate: Question["predicate"], value: string): Question => ({
  id: `${entityId}:${predicate}:${value.replace(/\s+/g, "_")}`,
  entityId,
  predicate,
  value,
  text: `${entityId} ${value}?`,
});
const QS: Question[] = [
  q("worker", "visible", "yes"),
  q("forklift", "visible", "yes"),
  q("forklift", "state", "near worker"),
  q("forklift", "state", "touching worker"),
  q("forklift", "state", "clear of worker"),
  q("forklift", "state", "moving"),
  q("forklift", "state", "stopped"),
  q("worker", "state", "dodging"),
];
const PAIRS: [string, string][] = [
  ["forklift:state:moving", "forklift:state:stopped"],
  ["forklift:state:touching_worker", "forklift:state:clear_of_worker"],
];
const REG = {
  entities: [
    { id: "worker", description: "worker on the warehouse floor" },
    { id: "forklift", description: "stand-up warehouse forklift" },
  ],
  people: [{ id: "worker", description: "the worker" }],
  questions: QS,
  exclusive: PAIRS,
};
const claim = (o: Partial<Claim>): Claim => ({
  id: "c",
  sceneId: "s",
  text: "The forklift touched the worker",
  actor: "",
  object: "forklift",
  action: "state touched worker",
  window: [0, 6],
  timeIsPrecise: false,
  ...o,
});

describe("validExclusivePairs", () => {
  it("keeps registered pairs whose two questions exist, differ, and are state questions of one entity", () => {
    expect(validExclusivePairs(PAIRS, QS)).toEqual(PAIRS);
  });

  it("drops pairs with an unknown question, a different entity, a non-state predicate or the same id", () => {
    const bad: unknown = [
      ["forklift:state:moving", "forklift:state:flying"],
      ["forklift:state:moving", "worker:state:dodging"],
      ["forklift:state:moving", "forklift:visible:yes"],
      ["forklift:state:moving", "forklift:state:moving"],
    ];
    expect(validExclusivePairs(bad, QS)).toEqual([]);
  });

  it("rejects malformed input instead of guessing", () => {
    for (const bad of [null, undefined, "x", 42, [["only-one"]], [[1, 2]], { a: 1 }]) expect(validExclusivePairs(bad, QS)).toEqual([]);
  });

  it("ignores questions that are not a list", () => {
    expect(validExclusivePairs(PAIRS, "nope")).toEqual([]);
  });
});

describe("registeredExclusivePairs", () => {
  it("reads Dev 1's QUESTION_SET_EXCLUSIVE as validated 2-tuples", () => {
    const pairs = registeredExclusivePairs();
    expect(Array.isArray(pairs)).toBe(true);
    for (const p of pairs) expect(p).toHaveLength(2);
  });

  it("honours Dev 1's removal of the unsafe sdg-nearmiss opposites (no inferred or restored pairs)", () => {
    expect(QUESTION_SET_EXCLUSIVE["sdg-nearmiss"]).toEqual([]);
    const flat = registeredExclusivePairs().flat();
    for (const id of ["forklift:state:clear_of_worker", "forklift:state:stopped"]) expect(flat).not.toContain(id);
  });

  it("an old scene whose questions still include stopped / clear_of_worker gets no state alternatives", () => {
    // QS mirrors those older scenes' questions.json; only registered pairs may create alternatives.
    const reg = { ...REG, exclusive: registeredExclusivePairs() };
    for (const [text, action, id] of [
      ["The forklift touched the worker", "state touched worker", "forklift:state:touching_worker"],
      ["The forklift was clear of the worker", "state clear of worker", "forklift:state:clear_of_worker"],
      ["The forklift was stopped", "state stopped", "forklift:state:stopped"],
      ["The forklift was moving", "state moving", "forklift:state:moving"],
    ] as const)
      expect(resolveGrounding(claim({ text, action }), reg).target).toEqual({ questionId: id, alternativeIds: [] });
  });
});

describe("grounding with registered exclusive pairs", () => {
  it("a state claim with a registered opposite gets that opposite as its only alternative", () => {
    expect(resolveGrounding(claim({}), REG).target).toEqual({
      questionId: "forklift:state:touching_worker",
      alternativeIds: ["forklift:state:clear_of_worker"],
      registeredExclusive: true,
    });
    expect(resolveGrounding(claim({ text: "The forklift was stopped", action: "state stopped" }), REG).target).toEqual({
      questionId: "forklift:state:stopped",
      alternativeIds: ["forklift:state:moving"],
      registeredExclusive: true,
    });
  });

  it("pairs work in both directions and use natural verb forms", () => {
    expect(resolveGrounding(claim({ text: "The forklift moved", action: "state moved" }), REG).target?.alternativeIds).toEqual(["forklift:state:stopped"]);
    expect(resolveGrounding(claim({ text: "The forklift was clear of the worker", action: "state clear of worker" }), REG).target?.alternativeIds).toEqual([
      "forklift:state:touching_worker",
    ]);
  });

  it("states without a registered opposite keep no alternatives (never contradicted)", () => {
    expect(resolveGrounding(claim({ text: "The forklift came near the worker", action: "state near worker" }), REG).target).toEqual({
      questionId: "forklift:state:near_worker",
      alternativeIds: [],
    });
    expect(resolveGrounding(claim({ object: "worker", text: "The worker dodged", action: "state dodged" }), REG).target?.alternativeIds).toEqual([]);
  });

  it("without registered pairs, state claims behave exactly as before", () => {
    const { exclusive: _x, ...noPairs } = REG;
    expect(resolveGrounding(claim({}), noPairs).target).toEqual({ questionId: "forklift:state:touching_worker", alternativeIds: [] });
  });

  it("invalid registered pairs are ignored, not trusted", () => {
    const reg = { ...REG, exclusive: [["forklift:state:touching_worker", "worker:state:dodging"]] };
    expect(resolveGrounding(claim({}), reg).target?.alternativeIds).toEqual([]);
  });
});

describe("negation and temporal-ordering guard", () => {
  const ungrounded = (text: string, action = "state touched worker") => {
    const g = resolveGrounding(claim({ text, action }), REG);
    return { target: g.target, why: g.reasons.join(" | ") };
  };

  it.each([
    "The forklift never touched the worker",
    "The forklift did not touch the worker",
    "The forklift didn't touch the worker",
    "It wasn't touching the worker",
    "No, the forklift touched nobody",
    "The forklift passed without touching the worker",
  ])("a negated claim is not graded as its positive form: %s", (text) => {
    const r = ungrounded(text);
    expect(r.target).toBeNull();
    expect(r.why).toMatch(/negation/);
  });

  it.each([
    ["The forklift stopped before reaching the worker", "state stopped"],
    ["The forklift kept moving until it hit the worker", "state moving"],
    ["By the time the worker dodged, the forklift had stopped", "state stopped"],
  ])("a temporal-ordering claim is not graded on one state alone: %s", (text, action) => {
    const r = ungrounded(text, action);
    expect(r.target).toBeNull();
    expect(r.why).toMatch(/order/);
  });

  it("plain claims, and words that merely contain those letters, are unaffected", () => {
    expect(resolveGrounding(claim({ text: "The forklift touched the worker at about 3 seconds" }), REG).target?.questionId).toBe(
      "forklift:state:touching_worker",
    );
    expect(resolveGrounding(claim({ text: "Then the forklift was stopped near the north wall", action: "state stopped" }), REG).target?.questionId).toBe(
      "forklift:state:stopped",
    );
  });
});
