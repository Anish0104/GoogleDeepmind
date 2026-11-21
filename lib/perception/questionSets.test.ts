// OWNER: Dev 1.
import { describe, expect, it } from "vitest";
import { QUESTION_SETS, WAREHOUSE_MOTION_QUESTION_IDS, WAREHOUSE_QUESTIONS } from "@/lib/perception/questionSets";

describe("WAREHOUSE_QUESTIONS", () => {
  it("has Q1-Q6 with stable ids in the <entity>:<predicate>:<value> format", () => {
    expect(WAREHOUSE_QUESTIONS.map((q) => q.id)).toEqual([
      "pedestrian:state:inside_crossing",
      "forklift:state:at_entry_line",
      "forklift:state:past_entry_line",
      "forklift:state:stationary",
      "pedestrian:visible:yes",
      "forklift:visible:yes",
    ]);
    for (const q of WAREHOUSE_QUESTIONS) {
      expect(q.id.startsWith(`${q.entityId}:${q.predicate}:`)).toBe(true);
      expect(q.text.length).toBeGreaterThan(10);
    }
  });

  it("gives every entity a visibility question, so each row gets a pVisible", () => {
    const entities = new Set(WAREHOUSE_QUESTIONS.map((q) => q.entityId));
    for (const e of entities) {
      expect(WAREHOUSE_QUESTIONS.some((q) => q.entityId === e && q.predicate === "visible")).toBe(true);
    }
  });

  it("states yes/no criteria and marks the motion question", () => {
    for (const q of WAREHOUSE_QUESTIONS) expect(q.text).toMatch(/\bno\b/i);
    expect(WAREHOUSE_MOTION_QUESTION_IDS).toEqual(["forklift:state:stationary"]);
    for (const id of WAREHOUSE_MOTION_QUESTION_IDS) expect(WAREHOUSE_QUESTIONS.some((q) => q.id === id)).toBe(true);
  });

  it("is registered by name", () => {
    expect(QUESTION_SETS.warehouse).toBe(WAREHOUSE_QUESTIONS);
  });
});

describe("SDG_NEARMISS_QUESTIONS (NVIDIA SDG-Warehouse forklift-human near miss)", () => {
  it("asks visibility for worker and forklift plus the four state questions the answer key covers", async () => {
    const { SDG_NEARMISS_QUESTIONS, SDG_NEARMISS_MOTION_QUESTION_IDS } = await import("@/lib/perception/questionSets");
    const { SDG_STATE_QUESTION_IDS } = await import("@/lib/capture/sdgTruth");
    const ids = SDG_NEARMISS_QUESTIONS.map((q) => q.id);
    expect(ids).toEqual(expect.arrayContaining(["worker:visible:yes", "forklift:visible:yes", ...SDG_STATE_QUESTION_IDS]));
    expect(ids).toHaveLength(2 + SDG_STATE_QUESTION_IDS.length);
    for (const q of SDG_NEARMISS_QUESTIONS) {
      expect(q.id.startsWith(`${q.entityId}:${q.predicate}:`)).toBe(true);
      expect(q.text).toMatch(/\bno\b/i);
    }
    expect(SDG_NEARMISS_MOTION_QUESTION_IDS).toEqual(["forklift:state:moving", "worker:state:dodging"]);
    expect(QUESTION_SETS["sdg-nearmiss"]).toBe(SDG_NEARMISS_QUESTIONS);
  });

  it("never mentions crossing lines, which these scenes do not have", async () => {
    const { SDG_NEARMISS_QUESTIONS } = await import("@/lib/perception/questionSets");
    for (const q of SDG_NEARMISS_QUESTIONS) expect(q.text).not.toMatch(/line|crossing/i);
  });
});

describe("named question sets carry their own registry (entities, people) and motion ids", () => {
  it("registers every entity its questions are about, with a description, so grounding can join them", async () => {
    const { QUESTION_SETS, questionSet } = await import("@/lib/perception/questionSets");
    for (const name of Object.keys(QUESTION_SETS)) {
      const set = questionSet(name);
      const ids = new Set(set.entities.map((e) => e.id));
      for (const q of set.questions) expect(ids.has(q.entityId), `${name}: ${q.entityId}`).toBe(true);
      for (const e of set.entities) expect(e.description.length).toBeGreaterThan(5);
      for (const id of set.motionIds) expect(set.questions.some((q) => q.id === id)).toBe(true);
    }
  });

  it("uses worker and forklift for the SDG near-miss set, and the worker is also a registered person", async () => {
    const { questionSet, SDG_NEARMISS_MOTION_QUESTION_IDS, QUESTION_SET_MOTION_IDS } = await import("@/lib/perception/questionSets");
    const set = questionSet("sdg-nearmiss");
    expect(set.entities.map((e) => e.id)).toEqual(["worker", "forklift"]);
    expect(set.people.map((p) => p.id)).toEqual(["worker"]);
    expect(set.motionIds).toEqual(SDG_NEARMISS_MOTION_QUESTION_IDS);
    expect(QUESTION_SET_MOTION_IDS["sdg-nearmiss"]).toEqual(SDG_NEARMISS_MOTION_QUESTION_IDS);
  });

  it("throws on an unknown set name, listing the known ones", async () => {
    const { questionSet } = await import("@/lib/perception/questionSets");
    expect(() => questionSet("nope")).toThrow(/sdg-nearmiss/);
  });
});

describe("QUESTION_SET_EXCLUSIVE", () => {
  it("has no sdg-nearmiss pairs until an opposite wording is validated (unsafe ones were removed)", async () => {
    const { QUESTION_SET_EXCLUSIVE, questionSet } = await import("@/lib/perception/questionSets");
    expect(QUESTION_SET_EXCLUSIVE["sdg-nearmiss"]).toEqual([]);
    const ids = questionSet("sdg-nearmiss").questions.map((q) => q.id);
    expect(ids).not.toContain("forklift:state:clear_of_worker");
    expect(ids).not.toContain("forklift:state:stopped");
  });

  it("only pairs questions of one set, about the same entity, asked over the same window", async () => {
    const { QUESTION_SET_EXCLUSIVE, questionSet } = await import("@/lib/perception/questionSets");
    for (const [name, pairs] of Object.entries(QUESTION_SET_EXCLUSIVE)) {
      const set = questionSet(name);
      for (const [a, b] of pairs) {
        const qa = set.questions.find((q) => q.id === a)!;
        const qb = set.questions.find((q) => q.id === b)!;
        expect(qa, a).toBeDefined();
        expect(qb, b).toBeDefined();
        expect(qa.entityId).toBe(qb.entityId);
        expect(qa.predicate).toBe("state");
        expect(set.motionIds.includes(a)).toBe(set.motionIds.includes(b)); // both on the 2 s clip, or both on the slice
      }
    }
  });
});
