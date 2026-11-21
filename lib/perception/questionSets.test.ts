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
