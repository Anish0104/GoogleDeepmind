// OWNER: Dev 2. Offline integration with production question formats: Dev 1's buildQuestions() ->
// fakeGrid() -> resolveGrounding() -> evidenceForTarget() -> selectCitation() -> auditCitation() -> verdict().
// Only checkWindow() (Dev 1's clip + Decision 1 boundary) is mocked; its answers are controlled, so
// this proves the wiring and safety rules, not live accuracy.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", () => ({ checkWindow: vi.fn() }));

import { checkWindow } from "@/lib/perception/checkWindow";
import { buildQuestions, type Person, type ScoutEntity } from "@/lib/perception/scout";
import { selectCitation } from "@/lib/inference/citation";
import { evidenceFor, evidenceForTarget } from "@/lib/inference/evidence";
import { fakeGrid } from "@/lib/inference/fake-grid";
import { verdict } from "@/lib/inference/verdict";
import { auditCitation } from "@/lib/truth/auditor";
import { resolveGrounding } from "@/lib/truth/grounding";
import type { CameraId, Claim, Event, Verdict } from "@/lib/types";

const cw = vi.mocked(checkWindow);

const ENTITIES: ScoutEntity[] = [
  { id: "red_mug", description: "red ceramic mug" },
  { id: "blue_mug", description: "blue ceramic mug" },
];
const PEOPLE: Person[] = [
  { id: "person_1", description: "person in red shirt" },
  { id: "person_2", description: "person in blue shirt" },
];
const QUESTIONS = buildQuestions(ENTITIES, PEOPLE);
const REGISTRY = { entities: ENTITIES, people: PEOPLE, questions: QUESTIONS };
const ev = (entityId: string, from: string, to: string, t: number): Event => ({ entityId, from, to, t, confidence: 1, cameras: [] });
// The red mug sits in B, person_1 holds it 3-6 s, and it ends in C from 6 s. Camera C is occluded 2-9 s.
const ROWS = fakeGrid({
  sceneId: "s1",
  cameras: ["A", "B", "C"],
  durationS: 16,
  truth: [ev("red_mug", "unknown", "B", 0), ev("red_mug", "none", "person_1", 3), ev("red_mug", "person_1", "none", 6), ev("red_mug", "B", "C", 6), ev("blue_mug", "unknown", "E", 0)],
  questions: QUESTIONS,
  noise: 0.1,
  sharedErrorRate: 0,
  occluded: [{ camera: "C", window: [2, 9] }],
  seed: 4,
});
const ALLOWED: CameraId[] = ["A", "B", "C"];

const claim = (o: Partial<Claim>): Claim => ({
  id: `s1:c-${o.action ?? "x"}`,
  sceneId: "s1",
  text: "",
  actor: "",
  object: "red mug",
  action: "move to zone C",
  window: [5, 8],
  timeIsPrecise: true,
  ...o,
});

/** Grounds, builds evidence, picks and audits a citation (mock answer), and returns the label. */
async function label(c: Claim, auditAnswer: { supports: number; contradicts: number }, goal: "support" | "contradict"): Promise<Verdict> {
  const g = resolveGrounding(c, REGISTRY);
  const evidence = evidenceForTarget(c, g.target, ROWS, QUESTIONS);
  const sel = selectCitation(c, g.target, ROWS, QUESTIONS, { goal, allowedCameras: ALLOWED, durationS: 16 });
  if (!sel.ok) return verdict(evidence, c, null);
  expect(sel.candidate.camera).not.toBe("C"); // occluded during these windows
  cw.mockResolvedValueOnce({ camera: sel.candidate.camera, window: sel.candidate.window, visible: 0.9, ...auditAnswer, clipId: "real", source: "initial" });
  return verdict(evidence, c, await auditCitation(c, sel.candidate));
}

beforeEach(() => cw.mockReset());

describe("grounded pipeline", () => {
  it("true move claim -> Supported", async () => {
    expect(await label(claim({ text: "Sam moved the red mug into zone C", actor: "Sam" }), { supports: 0.92, contradicts: 0.03 }, "support")).toBe("Supported");
  });

  it("false move claim (zone E) -> Contradicted, cameras see it in B/C throughout", async () => {
    const c = claim({ text: "Sam moved the red mug into zone E", actor: "Sam", action: "move to zone E" });
    expect(await label(c, { supports: 0.02, contradicts: 0.95 }, "contradict")).toBe("Contradicted");
  });

  it("take by a described person -> Supported via the person id the witness never said", async () => {
    const c = claim({ text: "The person in the red shirt picked up the red mug", actor: "person in red shirt", action: "pick up", window: [3, 6] });
    expect(resolveGrounding(c, REGISTRY).target?.questionId).toBe("red_mug:heldBy:person_1");
    expect(await label(c, { supports: 0.9, contradicts: 0.04 }, "support")).toBe("Supported");
  });

  it("take by a name -> unresolved person -> Insufficient, even with a confident audit answer", async () => {
    const c = claim({ text: "Sam picked up the red mug", actor: "Sam", action: "pick up", window: [3, 6] });
    expect(resolveGrounding(c, REGISTRY).target).toBeNull();
    expect(await label(c, { supports: 0.99, contradicts: 0.01 }, "support")).toBe("Insufficient");
    expect(cw).not.toHaveBeenCalled();
  });

  it("ambiguous object -> Insufficient, never a citation", async () => {
    const c = claim({ object: "the mug", text: "Sam moved the mug into zone C" });
    expect(await label(c, { supports: 0.99, contradicts: 0.01 }, "support")).toBe("Insufficient");
    expect(cw).not.toHaveBeenCalled();
  });

  it("the old string grounding is unchanged and cannot see person ids", () => {
    const c = claim({ text: "The person in the red shirt picked up the red mug", actor: "person in red shirt", action: "pick up", window: [3, 6] });
    expect(evidenceFor(c, ROWS, QUESTIONS).every((e) => e.supports === null)).toBe(true);
  });
});
