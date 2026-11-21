// OWNER: Dev 3. scripts/perceive.ts: runs scenes one after another, stops on the first failure, and compares
// scout's entity ids with the fixed question set's. Fakes only (no Gemini, no video).
import { describe, expect, it } from "vitest";
import type { Question, RunStatus } from "@/lib/types";
import { compareEntities, formatEntityComparison, perceiveScenes, type PerceiveRunner } from "@/scripts/perceive";

const q = (entityId: string, predicate: Question["predicate"], value: string): Question => ({
  id: `${entityId}:${predicate}:${value}`,
  entityId,
  predicate,
  value,
  text: "?",
});
const SDG = [q("worker", "visible", "yes"), q("forklift", "visible", "yes"), q("forklift", "state", "moving"), q("worker", "state", "dodging")];

describe("compareEntities", () => {
  it("lines up scout's entity ids against the question set's entity ids", () => {
    const c = compareEntities(
      [
        { id: "worker", description: "person in a hi-vis vest" },
        { id: "forklift_1", description: "yellow forklift" },
        { id: "pallet", description: "wooden pallet" },
      ],
      SDG,
    );
    expect(c.questionIds).toEqual(["forklift", "worker"]);
    expect(c.matching).toEqual(["worker"]);
    expect(c.onlyQuestions).toEqual(["forklift"]); // asked about, but scout named it differently
    expect(c.onlyScout).toEqual(["forklift_1", "pallet"]);
  });

  it("formats a side-by-side table that says plainly whether the ids match", () => {
    const text = formatEntityComparison(
      compareEntities([{ id: "worker", description: "person" }, { id: "forklift_1", description: "yellow forklift" }], SDG),
    );
    expect(text).toMatch(/entities\.json \(scout\)\s+\|\s+questions\.json entity ids/);
    expect(text).toMatch(/worker .*\|\s+worker\s+✓/);
    expect(text).toMatch(/\|\s+forklift\s+✗ no entity with this id/);
    expect(text).toMatch(/forklift_1 .*\|\s+—/);
    expect(text).toMatch(/MISMATCH: 1 question entity id has no entity in entities\.json: forklift/);
  });

  it("all ids matching is reported as such", () => {
    const text = formatEntityComparison(compareEntities([{ id: "worker" }, { id: "forklift" }], SDG));
    expect(text).toMatch(/OK: every question entity id is in entities\.json/);
  });
});

describe("perceiveScenes", () => {
  const status = (s: Partial<RunStatus>): RunStatus => ({ status: "perceived", stage: "perceived", startedAt: "t", ...s });

  it("runs scenes one after another, printing stages, Dev 1's steps and wall time; all perceived", async () => {
    const lines: string[] = [];
    let t = 0;
    const order: string[] = [];
    const run: PerceiveRunner = async (sceneId, onStage, onStep) => {
      order.push(`start ${sceneId}`);
      onStage("probe");
      t += 1000;
      onStage("perceive");
      onStep("sync", "presynced: zero offsets");
      t += 60_000;
      onStep("lattice", "960 rows");
      onStage("stills");
      order.push(`end ${sceneId}`);
      return status({});
    };
    const out = await perceiveScenes(["s1", "s2"], { run, log: (l) => lines.push(l), clock: () => t, afterScene: async () => {} });

    expect(out).toEqual({ ok: true, perceived: ["s1", "s2"] });
    expect(order).toEqual(["start s1", "end s1", "start s2", "end s2"]); // sequential
    expect(lines).toContain("[s1] probe +0.0s");
    expect(lines).toContain("[s1]   sync: presynced: zero offsets +1.0s");
    expect(lines).toContain("[s1] perceived in 61.0s");
  });

  it("stops at the first failure, naming the stage and error; later scenes don't run", async () => {
    const lines: string[] = [];
    const ran: string[] = [];
    const run: PerceiveRunner = async (sceneId) => {
      ran.push(sceneId);
      return sceneId === "s2" ? status({ status: "failed", stage: "perceive", error: "perceive (scout, after slice): 429" }) : status({});
    };
    const after: string[] = [];
    const out = await perceiveScenes(["s1", "s2", "s3"], { run, log: (l) => lines.push(l), clock: () => 0, afterScene: async (id) => void after.push(id) });

    expect(out).toEqual({ ok: false, perceived: ["s1"], failed: { sceneId: "s2", stage: "perceive", error: "perceive (scout, after slice): 429" } });
    expect(ran).toEqual(["s1", "s2"]);
    expect(after).toEqual(["s1"]); // the entity comparison only runs for perceived scenes
    expect(lines.at(-1)).toBe("[s2] FAILED at stage perceive: perceive (scout, after slice): 429");
  });
});
