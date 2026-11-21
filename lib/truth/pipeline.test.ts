// OWNER: Dev 2. Offline integration of the truth pipeline with the real Dev 2 code.
// Mocked ONLY at external boundaries:
//   - generateJson() / decide() in lib/gemini/client.ts (Carbon, Decisions API)
//   - checkWindow() in lib/perception/checkWindow.ts (Dev 1). By default the mock delegates to the REAL
//     stub, which throws "not implemented": that is the honest current state of clip cutting.
// Everything else runs for real: fakeGrid, splitClaims parsing, evidenceFor, audit validation and
// mapping, verdict, stateModel, judge provenance and citation validation.
// NOT exercised here: real video, real clip cutting, real model output. Audit results below come from
// controlled mock answers, so this proves the wiring and the safety rules, not live accuracy.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/perception/checkWindow")>();
  return { checkWindow: vi.fn(real.checkWindow) };
});

import { decide, generateJson } from "@/lib/gemini/client";
import { checkWindow } from "@/lib/perception/checkWindow";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { evidenceFor } from "@/lib/inference/evidence";
import { fakeGrid } from "@/lib/inference/fake-grid";
import { stateModel } from "@/lib/inference/state";
import { verdict } from "@/lib/inference/verdict";
import { audit, auditWithMedia, validateCitation } from "@/lib/truth/auditor";
import { splitClaims, type RawClaim } from "@/lib/truth/claims";
import { AuditUnavailableError } from "@/lib/truth/errors";
import { buildProvenance, judge } from "@/lib/truth/judge";
import type { Claim, Event, Evidence, Question } from "@/lib/types";

const gen = vi.mocked(generateJson);
const dec = vi.mocked(decide);
const cw = vi.mocked(checkWindow);

// ---------- one synthetic scene: 3 cameras, camera C occluded 4-9 s ----------

const QS: Question[] = [
  ...["B", "C", "D"].map((z) => ({ id: `mug-${z}`, entityId: "e1", predicate: "location" as const, value: z, text: `Is the mug in zone ${z}?` })),
  { id: "mug-sam", entityId: "e1", predicate: "heldBy", value: "sam", text: "Is Sam holding the mug?" },
  { id: "mug-ana", entityId: "e1", predicate: "heldBy", value: "ana", text: "Is Ana holding the mug?" },
];
const ev = (entityId: string, from: string, to: string, t: number): Event => ({ entityId, from, to, t, confidence: 1, cameras: [] });
const TRUTH = [ev("e1", "unknown", "B", 0), ev("e1", "none", "sam", 4), ev("e1", "sam", "none", 6), ev("e1", "B", "C", 6), ev("e1", "C", "D", 16)];
const OCCLUSION = [{ camera: "C" as const, window: [4, 9] as [number, number] }];
const ROWS = fakeGrid({ sceneId: "s1", cameras: ["A", "B", "C"], durationS: 24, truth: TRUTH, questions: QS, noise: 0.1, sharedErrorRate: 0, occluded: OCCLUSION, seed: 5 });

const TRANSCRIPT =
  "At 6 seconds Sam put the mug in zone C. At about 5 seconds Sam picked up the mug. " +
  "I think Sam gave the mug to Ana a few seconds later. At 6 seconds Sam put the mug in zone D. The mug was in zone B.";

const carbonClaims: RawClaim[] = [
  { text: "Sam put the mug in zone C", actor: "Sam", object: "mug", action: { kind: "move", zone: "C" }, time: { kind: "exact", t: 6 }, hedged: false },
  { text: "Sam picked up the mug", actor: "Sam", object: "mug", action: { kind: "take" }, time: { kind: "approx", t: 5 }, hedged: false },
  { text: "Sam gave the mug to Ana", actor: "Sam", object: "mug", action: { kind: "give", recipient: "Ana" }, time: { kind: "relative", relation: "after", anchor: 1, offsetS: 3 }, hedged: true },
  { text: "Sam put the mug in zone D", actor: "Sam", object: "mug", action: { kind: "move", zone: "D" }, time: { kind: "exact", t: 6 }, hedged: false },
  { text: "The mug was in zone B", actor: "", object: "mug", action: { kind: "located", zone: "B" }, time: { kind: "none" }, hedged: false },
];

/**
 * The citation a pipeline would pick: the strongest usable 1-4 s record that itself carries the score
 * at `min` or more. Returns null when no record qualifies (no silent fallback to an irrelevant view).
 */
function cite(evidence: Evidence[], key: "supports" | "contradicts", min: number): Evidence | null {
  const len = (e: Evidence) => e.window[1] - e.window[0];
  const ok = evidence.filter(
    (e) => e.visible >= THRESHOLDS.USABLE && len(e) >= LIMITS.CLIP_MIN_S && len(e) <= LIMITS.CLIP_MAX_S && (e[key] ?? -1) >= min,
  );
  return ok.sort((a, b) => b[key]! - a[key]!)[0] ?? null;
}

const OPAQUE_CLIP_PARTS = [{ placeholder: "resolved-cited-clip (opaque test object, never decoded)" }];

async function claimsFromCarbon(): Promise<Claim[]> {
  gen.mockResolvedValueOnce({ claims: carbonClaims } as never);
  return splitClaims(TRANSCRIPT, "s1");
}

beforeEach(() => {
  gen.mockReset();
  dec.mockReset();
  cw.mockClear();
});

// ---------- Pipeline A ----------

describe("Pipeline A: Carbon (mock) -> splitClaims -> evidenceFor -> audit -> verdict", () => {
  it("extracts four claims and withholds the untimed end-state claim", async () => {
    const claims = await claimsFromCarbon();
    expect(claims.map((c) => c.action)).toEqual(["move to zone C", "pick up", "give to ana", "move to zone D"]);
    expect(claims[2]!.text.startsWith("(uncertain)")).toBe(true);
  });

  it("true move claim: occluded camera C is unusable, A/B support, audit (decide mock) confirms -> Supported", async () => {
    const [move] = await claimsFromCarbon();
    const evidence = evidenceFor(move!, ROWS, QS);
    expect(evidence.filter((e) => e.camera === "C").every((e) => e.supports === null && e.contradicts === null)).toBe(true);
    const c = cite(evidence, "supports", THRESHOLDS.CLEAR)!;
    expect(["A", "B"]).toContain(c.camera);
    expect(validateCitation(move!, c)).toEqual({ ok: true });

    dec.mockResolvedValueOnce({ support: 0.93, contradict: 0.04, visible: 0.9 });
    const a = await auditWithMedia(move!, c, OPAQUE_CLIP_PARTS);
    expect(a.clipId).toBe(c.clipId);
    expect(verdict(evidence, move!, a)).toBe("Supported");
  });

  it("false move claim: cameras see the mug elsewhere throughout, audit confirms -> Contradicted", async () => {
    const claims = await claimsFromCarbon();
    const falseMove = claims[3]!;
    const evidence = evidenceFor(falseMove, ROWS, QS);
    const c = cite(evidence, "contradicts", THRESHOLDS.DECISIVE)!;
    expect(c).not.toBeNull();
    dec.mockResolvedValueOnce({ support: 0.03, contradict: 0.95, visible: 0.9 });
    expect(verdict(evidence, falseMove, await auditWithMedia(falseMove, c, OPAQUE_CLIP_PARTS))).toBe("Contradicted");
  });

  it("INTEGRATION GAP: a supporting run longer than 4 s cannot be audited as-is (never truncated)", async () => {
    const take = (await claimsFromCarbon())[1]!; // approx 5 s -> window [2, 8]
    const evidence = evidenceFor(take, ROWS, QS);
    const strong = evidence.filter((e) => (e.supports ?? 0) >= THRESHOLDS.CLEAR);
    expect(strong.map((e) => e.window)).toEqual([
      [2, 8],
      [2, 8],
    ]);
    expect(cite(evidence, "supports", THRESHOLDS.CLEAR)).toBeNull();
    await expect(audit(take, strong[0]!)).rejects.toThrow(/1-4 s/);
    expect(cw).not.toHaveBeenCalled();
    expect(verdict(evidence, take, null)).toBe("Insufficient");
  });

  it("true take claim -> Supported once a caller selects a 1-4 s window inside the run (checkWindow mocked)", async () => {
    const take = (await claimsFromCarbon())[1]!;
    const evidence = evidenceFor(take, ROWS, QS);
    const run = evidence.find((e) => e.camera === "A" && (e.supports ?? 0) >= THRESHOLDS.CLEAR)!;
    // A caller-chosen sub-window of camera A's usable supporting run (what Dev 3's bridge / Dev 1's
    // candidateTimes would pick). It is a narrower request, audited independently, not a copy of the run.
    const chosen: Evidence = { ...run, window: [4, 6], clipId: "grid:s1:A:4-6" };
    expect(validateCitation(take, chosen)).toEqual({ ok: true });
    cw.mockResolvedValueOnce({ ...chosen, visible: 0.9, supports: 0.91, contradicts: 0.05, clipId: "clips/real-cut.mp4" });
    const a = await audit(take, chosen);
    expect(cw).toHaveBeenCalledWith(expect.objectContaining({ camera: "A", window: [4, 6], sceneId: "s1" }));
    expect(a.clipId).toBe("grid:s1:A:4-6");
    expect(verdict(evidence, take, a)).toBe("Supported");
  });

  it("wrong recipient: no camera sees an alternative holder throughout, so it stays Insufficient even if an audit leans false", async () => {
    const give = (await claimsFromCarbon())[2]!;
    const evidence = evidenceFor(give, ROWS, QS);
    expect(cite(evidence, "contradicts", THRESHOLDS.DECISIVE)).toBeNull();
    expect(verdict(evidence, give, null)).toBe("Insufficient");
    const somewhere = evidence.find((e) => e.camera === "C" && e.visible >= THRESHOLDS.USABLE)!; // C [9, 11]
    dec.mockResolvedValueOnce({ support: 0.02, contradict: 0.97, visible: 0.9 });
    expect(verdict(evidence, give, await auditWithMedia(give, somewhere, OPAQUE_CLIP_PARTS))).toBe("Insufficient");
  });

  it("an audit that only sees an occluded view abstains, so even a true claim stays Insufficient", async () => {
    const [move] = await claimsFromCarbon();
    const evidence = evidenceFor(move!, ROWS, QS);
    const occluded = evidence.find((e) => e.camera === "C" && e.visible < THRESHOLDS.USABLE)!;
    const a = await audit(move!, { ...occluded, window: [5, 8] });
    expect(a).toMatchObject({ supportScore: null, contradictScore: null });
    expect(cw).not.toHaveBeenCalled();
    expect(verdict(evidence, move!, a)).toBe("Insufficient");
  });

  it("PENDING: with the real checkWindow stub, audit() is unavailable and the safe fallback is Insufficient", async () => {
    const falseMove = (await claimsFromCarbon())[3]!;
    const evidence = evidenceFor(falseMove, ROWS, QS);
    const c = cite(evidence, "contradicts", THRESHOLDS.DECISIVE)!;
    await expect(audit(falseMove, c)).rejects.toThrow(AuditUnavailableError);
    expect(verdict(evidence, falseMove, null)).toBe("Insufficient");
  });
});

// ---------- Pipeline B ----------

describe("Pipeline B: fakeGrid -> stateModel -> judge (Carbon mock)", () => {
  const events = stateModel(ROWS, QS);
  const prov = buildProvenance(events, ROWS);

  it("stateModel finds both moves and does not credit the occluded camera", () => {
    expect(events.map((e) => [e.from, e.to, e.t])).toEqual([
      ["B", "C", 6],
      ["C", "D", 16],
    ]);
    expect(events[0]!.cameras).toEqual(["A", "B"]);
    expect(events[1]!.cameras).toEqual(["A", "B", "C"]);
  });

  it("rejects an occluded-camera citation, retries once, and returns a validated chronological timeline", async () => {
    const [f1, f2] = prov.facts;
    const w = (f: typeof f1, cam: string) => f!.citable.find((c) => c.camera === cam)!.window;
    gen.mockResolvedValueOnce({
      sentences: [
        { text: "e1 moved from zone C to zone D at about 16 s.", eventIds: ["E2"], citations: [{ camera: "C", window: w(f2, "C") }] },
        { text: "e1 moved from zone B to zone C at about 6 s.", eventIds: ["E1"], citations: [{ camera: "C", window: [5, 7] }] },
      ],
    } as never);
    gen.mockResolvedValueOnce({
      sentences: [
        { text: "e1 moved from zone C to zone D at about 16 s.", eventIds: ["E2"], citations: [{ camera: "C", window: w(f2, "C") }] },
        {
          text: "e1 moved from zone B to zone C at about 6 s.",
          eventIds: ["E1"],
          citations: [
            { camera: "A", window: w(f1, "A") },
            { camera: "B", window: w(f1, "B") },
          ],
        },
      ],
    } as never);

    const out = await judge("What happened to e1?", events, ROWS);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(out.map((s) => s.text)).toEqual(["e1 moved from zone B to zone C at about 6 s.", "e1 moved from zone C to zone D at about 16 s."]);
    expect(out[0]!.citations.map((c) => c.camera)).toEqual(["A", "B"]);
    for (const s of out) for (const c of s.citations) expect(c.window[1] - c.window[0]).toBeLessThanOrEqual(LIMITS.CLIP_MAX_S);
  });

  it("a fabricated movement is never returned, even after retries", async () => {
    for (let i = 0; i < 3; i++)
      gen.mockResolvedValueOnce({
        sentences: [{ text: "e1 moved from zone B to zone F at about 6 s.", eventIds: ["E1"], citations: [{ camera: "A", window: [5, 7] }] }],
      } as never);
    expect(await judge("What happened?", events, ROWS)).toEqual([]);
  });
});
