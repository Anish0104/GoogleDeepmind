// OWNER: Dev 3. Matching extracted claims to statements and scoring them.
import { describe, expect, it } from "vitest";
import type { EvalAccount, Statement } from "@/scripts/eval/accounts";
import { classify, formatMarkdown, matchClaims, matchScore, scoreAccount, similarity, summarize, type ClaimLabel, type WarehouseReport } from "@/scripts/eval/score";

const st = (kind: Statement["kind"], text: string, truth: boolean, expected: Statement["expected"]): Statement => ({
  kind,
  text,
  truth,
  moment: [2, 4],
  expected,
});
const claim = (claimId: string, text: string, before: ClaimLabel["before"], after: ClaimLabel["after"], o: Partial<ClaimLabel> = {}): ClaimLabel => ({
  claimId,
  text,
  before,
  after,
  ...o,
});

describe("similarity and matching", () => {
  it("paraphrases from claim extraction still match; negation flips don't", () => {
    expect(similarity("The forklift hit the worker.", "The forklift hit the speaker")).toBeGreaterThan(0.5);
    expect(similarity("The forklift never touched the worker.", "The forklift never touched the worker")).toBeGreaterThan(0.3);
    expect(similarity("The forklift stopped before it reached the worker.", "The forklift didn't stop before it reached the worker.")).toBeLessThan(
      similarity("The forklift didn't stop before it reached the worker.", "The forklift did not stop before reaching the speaker"),
    );
    expect(similarity("The forklift hit the worker about 3 seconds in.", "The forklift hit the worker about 7 seconds in.")).toBeLessThan(1);
  });

  it("assigns each claim to at most one statement, best pairs first; weak pairs stay unmatched", () => {
    const statements = [
      st("contact", "The forklift hit the worker.", true, "Supported"),
      st("moving", "The forklift kept moving the whole time.", true, "Supported"),
      st("time", "The forklift hit the worker about 3 seconds in.", true, "Supported"),
    ];
    const claims = [
      claim("c1", "(uncertain) The forklift hit the speaker", "Supported", "Supported"),
      claim("c2", "The forklift hit the speaker about 3 seconds in", "Supported", "Supported"),
      claim("c3", "The speaker was wearing a vest", "Insufficient", "Insufficient"),
    ];
    const m = matchClaims(statements, claims);
    expect(m.get(0)?.claim.claimId).toBe("c1");
    expect(m.get(2)?.claim.claimId).toBe("c2");
    expect(m.has(1)).toBe(false); // "moving" was never extracted
  });
});

describe("matching claims split from a statement, and on object + action", () => {
  const dodge = st("dodge", "The worker dodged out of the way before the forklift got there.", true, "Supported");
  const moving = st("moving", "The forklift kept moving the whole time.", true, "Supported");

  it("a claim whose text is a piece of the statement matches it (containment), even with low word overlap", () => {
    const piece = claim("c1", "The worker dodged out of the way", "Insufficient", "Insufficient");
    expect(similarity(dodge.text, piece.text)).toBeLessThan(0.75);
    expect(matchScore(dodge, piece)).toBeGreaterThanOrEqual(0.85);
  });

  it("a claim matches on its object + action even when its text is odd", () => {
    const odd = claim("c2", "Yes, all along", "Insufficient", "Insufficient", { object: "forklift", action: "state kept moving" });
    expect(similarity(moving.text, odd.text)).toBe(0);
    expect(matchScore(moving, odd)).toBeGreaterThan(0.5);
  });

  it("negation still separates: a 'didn't dodge' claim doesn't take the 'dodged' statement over the right claim", () => {
    const neg = claim("c3", "The worker didn't dodge out of the way", "Insufficient", "Insufficient");
    const pos = claim("c4", "The worker dodged out of the way", "Insufficient", "Insufficient");
    expect(matchScore(dodge, pos)).toBeGreaterThan(matchScore(dodge, neg));
    expect(matchClaims([dodge], [neg, pos]).get(0)?.claim.claimId).toBe("c4");
  });

  it("single-word pieces don't match on containment alone", () => {
    expect(matchScore(moving, claim("c5", "moving", "Insufficient", "Insufficient"))).toBeLessThan(0.3);
  });

  it("the other half of a split statement is reported as an extra claim, not dropped", () => {
    const account: EvalAccount = { name: "true", flipped: [], transcript: "", statements: [dodge] };
    const scored = scoreAccount("s1", account, [
      claim("c1", "The worker dodged out of the way", "Insufficient", "Insufficient"),
      claim("c2", "The forklift got there", "Insufficient", "Insufficient"),
    ]);
    expect(scored.rows[0]!.claimId).toBe("c1");
    expect(scored.extraClaims.map((c) => c.text)).toEqual(["The forklift got there"]);
  });
});

describe("classify", () => {
  it.each([
    ["Supported", false, "Contradicted", "critical"],
    ["Contradicted", true, "Supported", "critical"],
    ["Supported", true, "Supported", "correct"],
    ["Contradicted", false, "Contradicted", "correct"],
    ["Insufficient", true, "Supported", "coverage-loss"],
    ["Insufficient", false, "Insufficient", "correct"],
    ["Supported", true, "Insufficient", "overreach"],
    ["Supported", false, "Insufficient", "critical"],
  ] as const)("label %s on a %s statement expected %s -> %s", (label, truth, expected, outcome) => {
    expect(classify(label, truth, expected)).toBe(outcome);
  });
});

describe("scoreAccount and summarize", () => {
  const account: EvalAccount = {
    name: "mixed",
    flipped: ["moving", "time"],
    transcript: "",
    statements: [
      st("contact", "The forklift hit the worker.", true, "Supported"),
      st("dodge", "The worker dodged out of the way before the forklift got there.", true, "Insufficient"),
      st("moving", "The forklift stopped at some point.", false, "Contradicted"),
      st("time", "The forklift hit the worker about 8 seconds in.", false, "Contradicted"),
      st("stop", "The forklift didn't stop before it reached the worker.", true, "Supported"),
    ],
  };
  const claims = [
    claim("c1", "The forklift hit the speaker", "Insufficient", "Supported"), // agents settled it
    claim("c2", "The speaker got out of the way before it reached them", "Insufficient", "Insufficient"),
    claim("c3", "The forklift stopped at some point", "Supported", "Insufficient"), // skeptic downgraded a critical error
    claim("c4", "The forklift hit the speaker about 8 seconds in", "Contradicted", "Contradicted"),
    claim("c5", "The speaker was in aisle 3", "Insufficient", "Insufficient"), // extra claim
  ];
  const scored = scoreAccount("s1", account, claims);

  it("scores each statement on the label after agents, keeping the before label", () => {
    expect(scored.rows.map((r) => [r.kind, r.claimId, r.before, r.after, r.outcomeBefore, r.outcome])).toEqual([
      ["contact", "c1", "Insufficient", "Supported", "coverage-loss", "correct"],
      ["dodge", "c2", "Insufficient", "Insufficient", "correct", "correct"],
      ["moving", "c3", "Supported", "Insufficient", "critical", "coverage-loss"],
      ["time", "c4", "Contradicted", "Contradicted", "correct", "correct"],
      ["stop", null, null, null, "miss", "miss"],
    ]);
    expect(scored.extraClaims.map((c) => c.claimId)).toEqual(["c5"]);
  });

  it("summarizes critical errors, correct, coverage loss, misses, expected-Insufficient and what agents changed", () => {
    const s = summarize(scored.rows);
    expect(s.statements).toBe(5);
    expect(s.misses).toBe(1);
    expect(s.matched).toBe(4);
    expect(s.critical.count).toBe(0);
    expect(s.criticalBefore).toBe(1);
    expect(s.correct.count).toBe(3);
    expect(s.coverageLoss).toBe(1);
    expect(s.expectedInsufficient).toEqual({ total: 1, handled: 1 });
    expect(s.agents).toEqual({ changed: 2, fixed: 1, broke: 0, criticalRemoved: 1, criticalAdded: 0 });
    expect(s.critical.high).toBeGreaterThan(0); // a Wilson interval, not a bare 0
  });

  it("formats a markdown report with the headline numbers and a before/after table", () => {
    const report: WarehouseReport = {
      generatedAt: "2026-11-21T20:00:00.000Z",
      agentMode: "standin",
      scenes: [{ sceneId: "s1", accounts: [{ name: "mixed", ...scored }] }],
    };
    report.scenes[0]!.accounts[0]!.rows[2]!.grid = "touching_worker max 0.47 < 0.8 (cam B at 3 s)";
    const md = formatMarkdown(report);
    expect(md).toMatch(/^# Warehouse eval/);
    expect(md).toMatch(/\| moving \| false \| Contradicted \| Supported → Insufficient \| coverage-loss \| touching_worker max 0\.47 < 0\.8 \(cam B at 3 s\) \|/);
    expect(md).toMatch(/## Extra claims \(extracted, matching no statement\)/);
    expect(md).toMatch(/- s1 \/ mixed: "The speaker was in aisle 3"/);
    expect(md).toMatch(/\| \*\*All scenes\*\* \| 5 \| 4 \| 1 \| 1 \|/); // statements, matched, misses, extra claims
    expect(md).toMatch(/Critical errors \(target 0\) \| 0 of 4/);
    expect(md).toMatch(/Agent mode: standin/);
  });

  it("an account that failed is reported, not scored", () => {
    const report: WarehouseReport = {
      generatedAt: "t",
      agentMode: "standin",
      scenes: [{ sceneId: "s1", accounts: [{ name: "true", rows: [], extraClaims: [], error: "429 budget" }] }],
    };
    expect(formatMarkdown(report)).toMatch(/s1 \/ true: not scored: 429 budget/);
  });
});
