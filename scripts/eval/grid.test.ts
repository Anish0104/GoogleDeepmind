// OWNER: Dev 3. Why a claim got its label: the grid near the moment for the question it grounded to.
// Real grounding (Dev 2's resolveGrounding) against the real sdg-nearmiss registry; a tiny fake grid.
import { describe, expect, it } from "vitest";
import { QUESTION_SET_ENTITIES, QUESTION_SET_PEOPLE, QUESTION_SETS } from "@/lib/perception/questionSets";
import type { CameraId, Claim, GridRow } from "@/lib/types";
import { gridDetail } from "@/scripts/eval/grid";

const registry = {
  entities: QUESTION_SET_ENTITIES["sdg-nearmiss"],
  people: QUESTION_SET_PEOPLE["sdg-nearmiss"],
  questions: QUESTION_SETS["sdg-nearmiss"],
};
const claim = (action: string, text: string): Claim => ({
  id: "c1",
  sceneId: "s1",
  text,
  actor: "",
  object: "forklift",
  action,
  window: [2, 5],
  timeIsPrecise: false,
});
const row = (camera: CameraId, t: number, questionId: string, pYes: number): GridRow => ({ sceneId: "s1", camera, t, questionId, pYes, pVisible: 0.9 });
const TOUCH = "forklift:state:touching_worker";

const rows: GridRow[] = [
  row("A", 2.5, TOUCH, 0.31),
  row("B", 3, TOUCH, 0.47), // the best included camera in the moment
  row("D", 3, TOUCH, 0.99), // excluded camera: ignored
  row("B", 8, TOUCH, 0.95), // outside the moment: ignored
  row("A", 3, "forklift:state:moving", 0.92),
];

describe("gridDetail", () => {
  it("a grounded claim: max pYes over included cameras in the moment, against CLEAR (0.8)", () => {
    expect(gridDetail(claim("state touching worker", "The forklift was touching the worker"), [2, 4], rows, ["A", "B", "C"], registry)).toBe(
      "touching_worker max 0.47 < 0.8 (cam B at 3 s)",
    );
  });

  it("at or above CLEAR is shown as such", () => {
    expect(gridDetail(claim("state moving", "The forklift was moving"), [2, 4], rows, ["A", "B", "C"], registry)).toBe(
      "moving max 0.92 ≥ 0.8 (cam A at 3 s)",
    );
  });

  it("persistence wording ('kept moving') reports Dev 2's persistence ungrounded reason", () => {
    expect(gridDetail(claim("state moving", "The forklift kept moving"), [2, 4], rows, ["A", "B", "C"], registry)).toMatch(
      /^ungrounded: claim asserts a state persisted continuously/,
    );
  });

  it("no rows for the question in the moment on included cameras", () => {
    expect(gridDetail(claim("state touching worker", "The forklift was touching the worker"), [6, 7], rows, ["A"], registry)).toBe(
      "touching_worker: no grid rows on included cameras in 6–7 s",
    );
  });

  it("an ungrounded claim says why (Dev 2's reason): it can only be Insufficient", () => {
    expect(gridDetail(claim("hit", "The forklift hit the worker"), [2, 4], rows, ["A", "B"], registry)).toBe(
      'ungrounded: action "hit" is not a canonical claim action',
    );
  });
});
