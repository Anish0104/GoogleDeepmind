// OWNER: Dev 2. Persistence wording ("stayed clear", "remained stopped throughout") asserts a state held
// continuously; grounding must not grade it as an ordinary point-in-time state. Ordinary claims, and the
// negation and temporal-ordering guards, must be unaffected.
import { describe, expect, it } from "vitest";
import { resolveGrounding, type SceneRegistry } from "@/lib/truth/grounding";
import type { Claim, Question } from "@/lib/types";

const q = (entityId: string, predicate: Question["predicate"], value: string): Question => ({ id: `${entityId}:${predicate}:${value.replace(/\s+/g, "_")}`, entityId, predicate, value, text: `${value}?` });
const REG: SceneRegistry = {
  entities: [{ id: "worker", description: "worker on the warehouse floor" }, { id: "forklift", description: "stand-up warehouse forklift" }],
  people: [{ id: "worker", description: "the worker" }],
  questions: [
    q("forklift", "state", "touching worker"),
    q("forklift", "state", "clear of worker"),
    q("forklift", "state", "moving"),
    q("forklift", "state", "stopped"),
    q("worker", "state", "dodging"),
  ],
};
const claim = (text: string, action: string, object = "forklift"): Claim => ({ id: "c", sceneId: "s", text, actor: "", object, action, window: [0, 10], timeIsPrecise: false });

describe("persistence guard", () => {
  it.each([
    ["The forklift stayed clear of the worker", "state clear of worker"],
    ["The forklift remained stopped throughout", "state stopped"],
    ["The forklift was moving the whole time", "state moving"],
    ["The forklift kept moving", "state moving"],
    ["The forklift keeps moving", "state moving"],
    ["The forklift was always clear of the worker", "state clear of worker"],
    ["The forklift was clear of the worker all along", "state clear of worker"],
    ["The forklift was stopped throughout", "state stopped"],
    ["The forklift remains clear of the worker", "state clear of worker"],
    ["The forklift was moving the entire time", "state moving"],
    ["The forklift was moving continuously", "state moving"],
    ["The forklift Stayed clear of the worker", "state clear of worker"],
  ])("%s -> ungrounded (persistence)", (text, action) => {
    const g = resolveGrounding(claim(text, action), REG);
    expect(g.target).toBeNull();
    expect(g.reasons.join(" ")).toMatch(/persist/);
  });

  it.each([
    ["The forklift was clear of the worker at 4 seconds", "state clear of worker", "forklift", "forklift:state:clear_of_worker"],
    ["The forklift was moving", "state moving", "forklift", "forklift:state:moving"],
    ["The forklift was stopped near the north wall", "state stopped", "forklift", "forklift:state:stopped"],
    ["The forklift touched the worker at about 3 seconds", "state touched worker", "forklift", "forklift:state:touching_worker"],
    ["The worker dodged out of the way", "state dodged", "worker", "worker:state:dodging"],
    ["The forklift was moving past the keeper", "state moving", "forklift", "forklift:state:moving"],
    ["The forklift was moving toward the stayed-in pallets", "state moving", "forklift", null],
  ])("ordinary claim: %s", (text, action, object, questionId) => {
    // "keeper" is not "keep" (word boundary); "stayed-in" contains the whole word "stayed" (conservative).
    expect(resolveGrounding(claim(text, action, object), REG).target?.questionId ?? null).toBe(questionId);
  });

  it("the ordinary point-in-time form keeps its exact previous grounding", () => {
    expect(resolveGrounding(claim("The forklift was clear of the worker", "state clear of worker"), REG).target).toEqual({ questionId: "forklift:state:clear_of_worker", alternativeIds: [] });
    expect(resolveGrounding(claim("The forklift was moving", "state moving"), REG).target).toEqual({ questionId: "forklift:state:moving", alternativeIds: [] });
  });

  it("negation and temporal-ordering guards are intact", () => {
    expect(resolveGrounding(claim("The forklift never touched the worker", "state touched worker"), REG).reasons.join(" ")).toMatch(/negation/);
    expect(resolveGrounding(claim("The forklift stopped before reaching the worker", "state stopped"), REG).reasons.join(" ")).toMatch(/order/);
  });
});
