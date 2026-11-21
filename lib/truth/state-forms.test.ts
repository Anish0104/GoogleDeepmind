// OWNER: Dev 2. Natural verb forms in state claims ("the worker dodged") must ground to the scene's
// state question ("dodging"). Same word, different form: never synonyms, never other predicates.
import { describe, expect, it } from "vitest";
import { resolveGrounding } from "@/lib/truth/grounding";
import { stateForm } from "@/lib/truth/text";
import type { Claim, Question } from "@/lib/types";

const q = (entityId: string, predicate: Question["predicate"], value: string): Question => ({
  id: `${entityId}:${predicate}:${value.replace(/\s+/g, "_")}`,
  entityId,
  predicate,
  value,
  text: `${entityId} ${value}?`,
});
// Mirrors the shape of Dev 1's fixed near-miss question set: entities forklift and worker, state questions.
const QS: Question[] = [
  q("worker", "visible", "yes"),
  q("forklift", "visible", "yes"),
  q("forklift", "state", "near worker"),
  q("forklift", "state", "touching worker"),
  q("forklift", "state", "moving"),
  q("worker", "state", "dodging"),
  q("box", "state", "tipped over"),
  q("box", "location", "C"),
];
const REG = {
  entities: [
    { id: "forklift", description: "forklift" },
    { id: "worker", description: "worker" },
    { id: "box", description: "cardboard box" },
  ],
  people: [],
  questions: QS,
};
const claim = (object: string, state: string): Claim => ({
  id: "c",
  sceneId: "s",
  text: "",
  actor: "",
  object,
  action: `state ${state}`,
  window: [0, 10],
  timeIsPrecise: false,
});
const target = (object: string, state: string) => resolveGrounding(claim(object, state), REG).target?.questionId ?? null;

describe("stateForm", () => {
  it("maps inflections of one word to one form", () => {
    for (const group of [
      ["dodging", "dodged", "dodge", "dodges"],
      ["moving", "moved", "move", "moves"],
      ["touching", "touched", "touch", "touches"],
      ["tipped over", "tipping over", "tip over", "tips over"],
      ["opened", "opening", "open", "opens"],
      ["closed", "closing", "close", "closes"],
      ["stopped", "stopping", "stop"],
    ])
      for (const w of group) expect(stateForm(w)).toBe(stateForm(group[0]!));
  });

  it("leaves short and suffix-like words alone and keeps different words apart", () => {
    expect(stateForm("red")).toBe("red");
    expect(stateForm("need")).toBe("need");
    expect(stateForm("stationary")).toBe("stationary");
    expect(stateForm("pass")).toBe(stateForm("passing"));
    expect(stateForm("near")).not.toBe(stateForm("next"));
    expect(stateForm("moving")).not.toBe(stateForm("mowing"));
  });

  it("ignores articles and keeps word order", () => {
    expect(stateForm("near the worker")).toBe(stateForm("near worker"));
    expect(stateForm("worker near")).not.toBe(stateForm("near worker"));
  });
});

describe("state grounding with natural verb forms", () => {
  it("past tense and base forms ground to the -ing state question", () => {
    expect(target("worker", "dodged")).toBe("worker:state:dodging");
    expect(target("forklift", "moved")).toBe("forklift:state:moving");
    expect(target("forklift", "touched worker")).toBe("forklift:state:touching_worker");
    expect(target("box", "tip over")).toBe("box:state:tipped_over");
  });

  it("still grounds the exact canonical value", () => {
    expect(target("forklift", "near worker")).toBe("forklift:state:near_worker");
  });

  it("never accepts synonyms or other words", () => {
    expect(target("forklift", "hit worker")).toBeNull();
    expect(target("worker", "jumped")).toBeNull();
    expect(target("forklift", "near")).toBeNull();
  });

  it("only relaxes state values, never the object, and never another entity's state", () => {
    expect(target("truck", "moved")).toBeNull();
    expect(target("worker", "moved")).toBeNull(); // "moving" belongs to the forklift
    expect(resolveGrounding({ ...claim("box", "x"), action: "move to zone C" }, REG).target?.questionId).toBe("box:location:C");
  });

  it("two question values with the same form are ambiguous, not guessed", () => {
    const dup = { ...REG, questions: [...QS, q("forklift", "state", "moved")] };
    expect(resolveGrounding(claim("forklift", "moving"), dup).target).toBeNull();
  });
});
