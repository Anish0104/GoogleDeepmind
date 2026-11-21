// OWNER: Dev 2. Tests for event F1 (kill test C).
import { describe, expect, it } from "vitest";
import { eventF1 } from "@/lib/inference/metrics";
import type { Event } from "@/lib/types";

const ev = (entityId: string, from: string, to: string, t: number): Event => ({
  entityId,
  from,
  to,
  t,
  confidence: 1,
  cameras: [],
});

describe("eventF1", () => {
  const truth = [ev("e1", "B", "C", 6), ev("e1", "C", "D", 14), ev("e2", "C", "B", 9)];

  it("is 1 for an exact match", () => {
    expect(eventF1(truth, truth)).toEqual({ precision: 1, recall: 1, f1: 1, matched: 3 });
  });

  it("matches within the time tolerance (inclusive) and not beyond it", () => {
    expect(eventF1([ev("e1", "B", "C", 7)], [ev("e1", "B", "C", 6)]).matched).toBe(1);
    expect(eventF1([ev("e1", "B", "C", 7.01)], [ev("e1", "B", "C", 6)]).matched).toBe(0);
    expect(eventF1([ev("e1", "B", "C", 8)], [ev("e1", "B", "C", 6)], 2).matched).toBe(1);
  });

  it("requires the same entity, from and to", () => {
    expect(eventF1([ev("e2", "B", "C", 6)], [ev("e1", "B", "C", 6)]).matched).toBe(0);
    expect(eventF1([ev("e1", "B", "D", 6)], [ev("e1", "B", "C", 6)]).matched).toBe(0);
    expect(eventF1([ev("e1", "A", "C", 6)], [ev("e1", "B", "C", 6)]).matched).toBe(0);
  });

  it("matches each truth event at most once", () => {
    const r = eventF1([ev("e1", "B", "C", 6), ev("e1", "B", "C", 6.5)], [ev("e1", "B", "C", 6)]);
    expect(r).toEqual({ precision: 0.5, recall: 1, f1: 2 / 3, matched: 1 });
  });

  it("pairs each prediction with the closest free truth event", () => {
    const pred = [ev("e1", "B", "C", 6.9), ev("e1", "B", "C", 5.2)];
    const tr = [ev("e1", "B", "C", 5), ev("e1", "B", "C", 6)];
    expect(eventF1(pred, tr).matched).toBe(2);
  });

  it("scores partial results", () => {
    const r = eventF1([truth[0]!, ev("e1", "D", "B", 20)], truth);
    expect(r.precision).toBe(0.5);
    expect(r.recall).toBeCloseTo(1 / 3);
    expect(r.f1).toBeCloseTo(0.4);
  });

  it("defines empty inputs", () => {
    expect(eventF1([], [])).toEqual({ precision: 1, recall: 1, f1: 1, matched: 0 });
    expect(eventF1([], truth)).toEqual({ precision: 1, recall: 0, f1: 0, matched: 0 });
    expect(eventF1(truth, [])).toEqual({ precision: 0, recall: 1, f1: 0, matched: 0 });
  });
});
