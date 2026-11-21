// OWNER: Dev 2. Tests for grid cleaning and value normalisation shared by evidence and state.
import { describe, expect, it } from "vitest";
import { indexGrid, indexQuestions, isUnknownValue, normText, normValue, sliceWindow, toZone } from "@/lib/inference/grid";
import type { GridRow, Question } from "@/lib/types";

const row = (o: Partial<GridRow> = {}): GridRow => ({
  sceneId: "s1",
  camera: "A",
  t: 1,
  questionId: "q1",
  pYes: 0.9,
  pVisible: 0.9,
  ...o,
});

describe("normalisation", () => {
  it("normText lowercases, trims, collapses whitespace and drops punctuation", () => {
    expect(normText("  The  Red-Mug?! ")).toBe("the red-mug");
  });

  it("toZone accepts bare letters and 'zone X' in any case", () => {
    expect(toZone("C")).toBe("C");
    expect(toZone("zone c")).toBe("C");
    expect(toZone(" Zone  F ")).toBe("F");
    expect(toZone("G")).toBeNull();
    expect(toZone("table")).toBeNull();
  });

  it("normValue canonicalises zones for location only", () => {
    expect(normValue("location", "zone b")).toBe("B");
    expect(normValue("location", "Shelf")).toBe("shelf");
    expect(normValue("heldBy", "Sam ")).toBe("sam");
    expect(normValue("state", "Tipped  Over")).toBe("tipped over");
  });

  it("isUnknownValue recognises the unknown tokens only", () => {
    expect(isUnknownValue("")).toBe(true);
    expect(isUnknownValue(" Unknown ")).toBe(true);
    expect(isUnknownValue("?")).toBe(true);
    expect(isUnknownValue("none")).toBe(false);
    expect(isUnknownValue("B")).toBe(false);
  });

  it("sliceWindow spans one SLICE_S", () => {
    expect(sliceWindow(10)).toEqual([10, 10.5]);
  });
});

describe("indexGrid", () => {
  it("keeps valid rows sorted by time, camera, question", () => {
    const g = indexGrid([
      row({ t: 1, camera: "B" }),
      row({ t: 0.5, camera: "A", questionId: "q2" }),
      row({ t: 1, camera: "A" }),
      row({ t: 0.5, camera: "A", questionId: "q1" }),
    ]);
    expect(g.cells.map((c) => `${c.t}${c.camera}${c.questionId}`)).toEqual(["0.5Aq1", "0.5Aq2", "1Aq1", "1Bq1"]);
    expect(g.dropped).toEqual({ malformed: 0, conflicting: 0, otherScene: 0 });
  });

  it("filters to one scene when asked and counts the rest", () => {
    const g = indexGrid([row(), row({ sceneId: "s2" })], "s1");
    expect(g.cells).toHaveLength(1);
    expect(g.dropped.otherScene).toBe(1);
    expect([...g.sceneIds]).toEqual(["s1"]);
  });

  it("collapses identical duplicates so they cannot add weight", () => {
    const g = indexGrid([row(), row(), row()]);
    expect(g.cells).toHaveLength(1);
    expect(g.dropped.conflicting).toBe(0);
  });

  it("drops every copy of a cell whose duplicates disagree", () => {
    const g = indexGrid([row({ pYes: 0.9 }), row({ pYes: 0.1 }), row({ t: 2 })]);
    expect(g.cells.map((c) => c.t)).toEqual([2]);
    expect(g.dropped.conflicting).toBe(2);
  });

  it("drops malformed rows instead of coercing them", () => {
    const bad = [
      row({ pYes: Number.NaN }),
      row({ pYes: 1.2 }),
      row({ pVisible: -0.1 }),
      row({ pVisible: Number.POSITIVE_INFINITY }),
      row({ t: -1 }),
      row({ t: Number.NaN }),
      row({ camera: "Z" as never }),
      row({ questionId: "" }),
      row({ sceneId: "" }),
      null as never,
    ];
    const g = indexGrid([...bad, row({ t: 3 })]);
    expect(g.cells).toHaveLength(1);
    expect(g.dropped.malformed).toBe(bad.length);
  });
});

describe("indexQuestions", () => {
  const q = (o: Partial<Question> = {}): Question => ({
    id: "q1",
    entityId: "e1",
    predicate: "location",
    value: "C",
    text: "Is the red mug in zone C?",
    ...o,
  });

  it("indexes questions by id", () => {
    const m = indexQuestions([q(), q({ id: "q2", value: "B" })]);
    expect([...m.keys()]).toEqual(["q1", "q2"]);
  });

  it("keeps one copy of identical duplicates", () => {
    expect(indexQuestions([q(), q()]).size).toBe(1);
  });

  it("drops ids whose duplicates disagree, and invalid questions", () => {
    const m = indexQuestions([
      q(),
      q({ value: "B" }),
      q({ id: "" }),
      q({ id: "q3", entityId: "" }),
      q({ id: "q4", predicate: "colour" as never }),
      q({ id: "q5" }),
    ]);
    expect([...m.keys()]).toEqual(["q5"]);
  });
});
