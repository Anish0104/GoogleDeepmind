// OWNER: Dev 2. Demo compatibility for claim extraction: scene duration for untimed claims, and state
// phrases that allow optional articles ("past the entry line" ~ "past entry line"). Carbon is mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));

import { generateJson } from "@/lib/gemini/client";
import { parseClaimsResponse, splitClaims, type ClaimWire } from "@/lib/truth/claims";
import { ClaimExtractionError } from "@/lib/truth/errors";
import { mentionsAllowingArticles } from "@/lib/truth/text";

const gen = vi.mocked(generateJson);
beforeEach(() => gen.mockReset());

const T = "The pedestrian was inside the crossing. At 00:06 the forklift went past the entry line. At 00:15 the forklift was stationary.";
const wire = (o: Partial<ClaimWire>): ClaimWire => ({
  text: "The forklift went past the entry line",
  actor: "",
  object: "forklift",
  actionKind: "state",
  stateValue: "past entry line",
  timeKind: "exact",
  t: 6,
  hedged: false,
  ...o,
});
const UNTIMED = wire({ text: "The pedestrian was inside the crossing", object: "pedestrian", stateValue: "inside the crossing", timeKind: "none", t: undefined });

describe("splitClaims: scene duration for untimed claims", () => {
  it("withholds an untimed claim when no duration is given (unchanged behaviour)", async () => {
    gen.mockResolvedValueOnce({ claims: [UNTIMED] } as never);
    expect(await splitClaims(T, "s1")).toEqual([]);
  });

  it("keeps an untimed claim over the whole scene, never precise, when the duration is known", async () => {
    gen.mockResolvedValueOnce({ claims: [UNTIMED] } as never);
    const [c] = await splitClaims(T, "s1", { durationS: 16 });
    expect(c).toMatchObject({ window: [0, 16], timeIsPrecise: false, action: "state inside crossing" });
  });

  it("timed claims inside the scene keep identical windows and ids with or without the duration", async () => {
    const timed = [wire({}), wire({ text: "The forklift was stationary", stateValue: "stationary", t: 15 - 3 })];
    gen.mockResolvedValueOnce({ claims: timed } as never);
    const without = await splitClaims(T, "s1");
    gen.mockResolvedValueOnce({ claims: timed } as never);
    const withD = await splitClaims(T, "s1", { durationS: 16 });
    expect(withD).toEqual(without);
  });

  it("with a duration, a timed window crossing the scene end is clipped and a time past the end is rejected", () => {
    const near = parseClaimsResponse({ claims: [wire({ text: "The forklift was stationary", stateValue: "stationary", t: 15 })] }, T, "s1", { durationS: 16 });
    expect(near.claims[0]!.window).toEqual([14, 16]);
    expect(parseClaimsResponse({ claims: [wire({ t: 20 })] }, T, "s1", { durationS: 16 }).claims).toEqual([]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects an invalid duration %s before calling the model", async (durationS) => {
    await expect(splitClaims(T, "s1", { durationS })).rejects.toThrow(ClaimExtractionError);
    expect(gen).not.toHaveBeenCalled();
  });

  it("still returns [] for an empty transcript without a call, with a duration", async () => {
    expect(await splitClaims("  ", "s1", { durationS: 16 })).toEqual([]);
    expect(gen).not.toHaveBeenCalled();
  });
});

describe("state phrases with optional articles", () => {
  const parse = (o: Partial<ClaimWire>, transcript = T) => parseClaimsResponse({ claims: [wire(o)] }, transcript, "s1");

  it("canonical 'past entry line' matches 'past the entry line' in the transcript", () => {
    expect(parse({}).claims[0]).toMatchObject({ action: "state past entry line" });
  });

  it("witness wording with articles becomes the canonical, article-free state", () => {
    expect(parse({ stateValue: "past the entry line" }).claims[0]!.action).toBe("state past entry line");
    expect(parse({ stateValue: "The past entry line" }).claims[0]!.action).toBe("state past entry line");
  });

  it("rejects a state missing a meaningful word or with the words out of order", () => {
    expect(parse({}, "At 00:06 the forklift went past the line.").rejected[0]!.reason).toMatch(/state/);
    expect(parse({}, "At 00:06 the forklift went entry past the line.").rejected[0]!.reason).toMatch(/state/);
  });

  it("rejects unrelated states and other words in between (no synonyms, no relaxed matching)", () => {
    expect(parse({ stateValue: "beyond entry line" }).rejected[0]!.reason).toMatch(/state/);
    expect(parse({}, "At 00:06 the forklift went past the yellow entry line.").rejected[0]!.reason).toMatch(/state/);
  });

  it("does not relax entity matching", () => {
    expect(parse({ object: "truck" }).rejected[0]!.reason).toMatch(/object/);
  });

  it("existing state claims are unchanged", () => {
    const r = parseClaimsResponse(
      { claims: [{ text: "Sam opened the box", actor: "Sam", object: "box", actionKind: "state", stateValue: "open", timeKind: "exact", t: 5, hedged: false }] },
      "Sam opened the box at 5 seconds.",
      "s1",
    );
    expect(r.claims[0]!.action).toBe("state open");
  });
});

describe("mentionsAllowingArticles", () => {
  it("allows at most one article between meaningful words, keeping order and every word", () => {
    expect(mentionsAllowingArticles("went past the entry line", "past entry line")).toBe(true);
    expect(mentionsAllowingArticles("went past an entry line", "past entry line")).toBe(true);
    expect(mentionsAllowingArticles("went past entry line", "past entry line")).toBe(true);
    expect(mentionsAllowingArticles("went past the the entry line", "past entry line")).toBe(false);
    expect(mentionsAllowingArticles("went past the line", "past entry line")).toBe(false);
    expect(mentionsAllowingArticles("entry past line", "past entry line")).toBe(false);
    expect(mentionsAllowingArticles("past the yellow entry line", "past entry line")).toBe(false);
  });

  it("ignores articles inside the phrase itself and keeps simple inflections when asked", () => {
    expect(mentionsAllowingArticles("inside the crossing", "inside the crossing")).toBe(true);
    expect(mentionsAllowingArticles("he opened the box", "open", true)).toBe(true);
    expect(mentionsAllowingArticles("he opened the box", "open")).toBe(false);
    expect(mentionsAllowingArticles("anything", "the")).toBe(false);
  });
});
