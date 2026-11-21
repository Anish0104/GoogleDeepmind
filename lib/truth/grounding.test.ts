// OWNER: Dev 2. Tests for resolveGrounding(): linking a Claim's witness words to scene registry ids
// without changing the Claim. Questions come from Dev 1's real buildQuestions(), so the id/value
// formats here are the production ones.
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/config";
import { buildQuestions, type Person, type ScoutEntity } from "@/lib/perception/scout";
import { evidenceForTarget } from "@/lib/inference/evidence";
import { resolveGrounding, type SceneRegistry } from "@/lib/truth/grounding";
import type { Claim, GridRow } from "@/lib/types";

const ENTITIES: ScoutEntity[] = [
  { id: "red_mug", description: "red ceramic mug" },
  { id: "blue_mug", description: "blue ceramic mug" },
  { id: "box", description: "cardboard box", states: ["open", "closed"] },
];
const PEOPLE: Person[] = [
  { id: "person_1", description: "person in red shirt" },
  { id: "person_2", description: "person in blue shirt" },
];
const reg = (o: Partial<{ entities: unknown; people: unknown; questions: unknown }> = {}): SceneRegistry => {
  const entities = (o.entities ?? ENTITIES) as ScoutEntity[];
  const people = (o.people ?? PEOPLE) as Person[];
  return { entities, people, questions: o.questions ?? buildQuestions(ENTITIES, PEOPLE), ...o };
};

const claim = (o: Partial<Claim> = {}): Claim => ({
  id: "s1:c-abc",
  sceneId: "s1",
  text: "Sam moved the red mug into zone C",
  actor: "Sam",
  object: "red mug",
  action: "move to zone C",
  window: [8, 11],
  timeIsPrecise: true,
  ...o,
});

const zones = (entity: string, except: string) => ["A", "B", "C", "D", "E", "F"].filter((z) => z !== except).map((z) => `${entity}:location:${z}`);

describe("resolveGrounding: objects", () => {
  it("resolves an object by a unique description match and targets the location question", () => {
    const g = resolveGrounding(claim({ object: "the red ceramic mug" }), reg());
    expect(g.entity).toEqual({ status: "resolved", id: "red_mug", via: "description" });
    expect(g.target).toEqual({ questionId: "red_mug:location:C", alternativeIds: zones("red_mug", "C") });
    expect(g.actor).toBeNull();
    expect(g.recipient).toBeNull();
  });

  it("an object phrase equal to an id with underscores as spaces resolves by id", () => {
    expect(resolveGrounding(claim({ object: "red mug" }), reg()).entity).toEqual({ status: "resolved", id: "red_mug", via: "id" });
  });

  it("resolves an object by exact entity id", () => {
    expect(resolveGrounding(claim({ object: "box", action: "move to zone B" }), reg()).entity).toEqual({
      status: "resolved",
      id: "box",
      via: "id",
    });
  });

  it("leaves two similar objects unresolved instead of picking one", () => {
    const g = resolveGrounding(claim({ object: "the mug" }), reg());
    expect(g.entity).toMatchObject({ status: "unresolved", candidates: ["blue_mug", "red_mug"] });
    expect(g.target).toBeNull();
  });

  it("does not resolve generic or unknown objects", () => {
    expect(resolveGrounding(claim({ object: "the thing" }), reg()).entity.status).toBe("unresolved");
    expect(resolveGrounding(claim({ object: "teapot" }), reg()).entity.status).toBe("unresolved");
  });

  it("treats an end-state claim like a location claim", () => {
    const g = resolveGrounding(claim({ action: "located in zone D", text: "The red mug was in zone D", actor: "" }), reg());
    expect(g.target?.questionId).toBe("red_mug:location:D");
  });

  it("state claims target the state question with no alternatives", () => {
    const g = resolveGrounding(claim({ object: "cardboard box", action: "state open" }), reg());
    expect(g.target).toEqual({ questionId: "box:state:open", alternativeIds: [] });
  });

  it("is ungrounded when the entity has no question for the claimed value", () => {
    expect(resolveGrounding(claim({ object: "cardboard box", action: "state tipped" }), reg()).target).toBeNull();
  });

  it("only accepts canonical action strings", () => {
    for (const action of ["put", "moved it to zone C", "looked at", "", "move to zone Q"])
      expect(resolveGrounding(claim({ action }), reg()).target).toBeNull();
  });
});

describe("resolveGrounding: people", () => {
  const take = (actor: string) => claim({ action: "pick up", actor, text: `${actor} picked up the red mug` });

  it("resolves a person only from a distinguishing description the witness actually gave", () => {
    const g = resolveGrounding(take("the person in the red shirt"), reg());
    expect(g.actor).toEqual({ status: "resolved", id: "person_1", via: "description" });
    expect(g.target).toEqual({
      questionId: "red_mug:heldBy:person_1",
      alternativeIds: ["red_mug:heldBy:person_2", "red_mug:heldBy:none"],
    });
  });

  it("never links a name to a scout person from clothing alone", () => {
    const g = resolveGrounding(take("Sam"), reg());
    expect(g.actor).toMatchObject({ status: "unresolved" });
    expect(g.target).toBeNull();
  });

  it("does not resolve a generic word even when only one person was seen", () => {
    const one = reg({ people: [PEOPLE[0]], questions: buildQuestions(ENTITIES, [PEOPLE[0]!]) });
    expect(resolveGrounding(take("the person"), one).actor).toMatchObject({ status: "unresolved" });
  });

  it("leaves ambiguous people unresolved", () => {
    const people: Person[] = [...PEOPLE, { id: "person_3", description: "person in red hat" }];
    const r = reg({ people, questions: buildQuestions(ENTITIES, people) });
    expect(resolveGrounding(take("person in red"), r).actor).toMatchObject({
      status: "unresolved",
      candidates: ["person_1", "person_3"],
    });
  });

  it("resolves a person by exact id", () => {
    expect(resolveGrounding(take("person_2"), reg()).actor).toEqual({ status: "resolved", id: "person_2", via: "id" });
  });

  describe("give / hand-over", () => {
    const give = (actor: string, recipient: string) =>
      claim({ action: `give to ${recipient}`, actor, text: `${actor} handed the red mug to the ${recipient}` });

    it("grounds the recipient to its heldBy question, separately from the actor", () => {
      const g = resolveGrounding(give("person in red shirt", "person in blue shirt"), reg());
      expect(g.actor).toMatchObject({ status: "resolved", id: "person_1" });
      expect(g.recipient).toMatchObject({ status: "resolved", id: "person_2" });
      expect(g.target).toEqual({
        questionId: "red_mug:heldBy:person_2",
        alternativeIds: ["red_mug:heldBy:person_1", "red_mug:heldBy:none"],
      });
    });

    it("needs only the recipient: an unresolved actor does not block or redirect the target", () => {
      const g = resolveGrounding(give("Sam", "person in blue shirt"), reg());
      expect(g.actor).toMatchObject({ status: "unresolved" });
      expect(g.target?.questionId).toBe("red_mug:heldBy:person_2");
    });

    it("an unresolved recipient leaves the claim ungrounded (never falls back to raw text)", () => {
      const g = resolveGrounding(give("person in red shirt", "ana"), reg());
      expect(g.recipient).toMatchObject({ status: "unresolved" });
      expect(g.target).toBeNull();
    });

    it("actor and recipient resolving to the same person is a conflict", () => {
      const g = resolveGrounding(give("person in red shirt", "person in red shirt"), reg());
      expect(g.target).toBeNull();
      expect(g.reasons.join(" ")).toMatch(/same person/);
    });

    it("a recipient with no heldBy question for this object stays ungrounded", () => {
      const people: Person[] = [...PEOPLE, { id: "person_9", description: "person in green coat" }];
      const g = resolveGrounding(give("person in red shirt", "person in green coat"), reg({ people }));
      expect(g.recipient).toMatchObject({ status: "unresolved" });
      expect(g.target).toBeNull();
    });
  });
});

describe("resolveGrounding: registry validation", () => {
  it("absent registries leave everything unresolved without throwing", () => {
    for (const r of [{}, { entities: null, people: null, questions: null }, { entities: [], people: [], questions: [] }] as SceneRegistry[]) {
      const g = resolveGrounding(claim(), r);
      expect(g.entity.status).toBe("unresolved");
      expect(g.target).toBeNull();
    }
  });

  it("malformed registries are rejected, not trusted", () => {
    const g = resolveGrounding(claim(), { entities: "red_mug", people: { a: 1 }, questions: 42 } as unknown as SceneRegistry);
    expect(g.target).toBeNull();
    expect(g.reasons.join(" ")).toMatch(/registry/);
  });

  it("drops invalid and conflicting entity entries", () => {
    const entities = [
      { id: "", description: "red ceramic mug" },
      { id: "red_mug", description: "red ceramic mug" },
      { id: "red_mug", description: "something else" },
      { id: 7, description: "x" },
    ];
    const g = resolveGrounding(claim(), reg({ entities }));
    expect(g.entity.status).toBe("unresolved");
    expect(g.reasons.join(" ")).toMatch(/conflicting|invalid/);
  });

  it("identical duplicate entries are collapsed", () => {
    expect(resolveGrounding(claim(), reg({ entities: [...ENTITIES, ENTITIES[0]] })).target?.questionId).toBe("red_mug:location:C");
  });

  it("conflicting person entries cannot be resolved", () => {
    const people = [...PEOPLE, { id: "person_1", description: "person in green coat" }];
    expect(resolveGrounding(claim({ action: "pick up", actor: "person in red shirt" }), reg({ people })).actor?.status).toBe("unresolved");
  });

  it("ignores questions about unknown entities and heldBy values that are not registered people", () => {
    const questions = [
      ...buildQuestions(ENTITIES, PEOPLE).filter((x) => x.predicate !== "heldBy"),
      { id: "red_mug:heldBy:ghost", entityId: "red_mug", predicate: "heldBy", value: "ghost", text: "?" },
      { id: "zz:location:C", entityId: "zz", predicate: "location", value: "C", text: "?" },
    ];
    const g = resolveGrounding(claim({ action: "pick up", actor: "person in red shirt" }), reg({ questions }));
    // The take actor determines the target, so it must map to a real heldBy question for this object.
    expect(g.actor).toMatchObject({ status: "unresolved" });
    expect(g.target).toBeNull();
  });

  it("two questions for the same value are ambiguous", () => {
    const questions = [...buildQuestions(ENTITIES, PEOPLE), { id: "dup", entityId: "red_mug", predicate: "location", value: "C", text: "?" }];
    expect(resolveGrounding(claim(), reg({ questions })).target).toBeNull();
  });
});

describe("resolveGrounding: guarantees", () => {
  it("never mutates the claim and reports its id", () => {
    const c = claim();
    const snap = JSON.stringify(c);
    const g = resolveGrounding(c, reg());
    expect(JSON.stringify(c)).toBe(snap);
    expect(g.claimId).toBe("s1:c-abc");
  });

  it("is deterministic", () => {
    expect(resolveGrounding(claim(), reg())).toEqual(resolveGrounding(claim(), reg()));
  });

  it("an ungrounded result can never produce support or contradiction", () => {
    const rows: GridRow[] = [];
    for (let t = 8; t < 11; t += LIMITS.SLICE_S)
      for (const qq of buildQuestions(ENTITIES, PEOPLE)) rows.push({ sceneId: "s1", camera: "A", t, questionId: qq.id, pYes: 0.99, pVisible: 0.99 });
    const c = claim({ object: "the mug" });
    const g = resolveGrounding(c, reg());
    const e = evidenceForTarget(c, g.target, rows, buildQuestions(ENTITIES, PEOPLE));
    expect(e.every((x) => x.supports === null && x.contradicts === null && x.visible === 0)).toBe(true);
  });
});
