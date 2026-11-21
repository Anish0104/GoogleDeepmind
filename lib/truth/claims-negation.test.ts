// OWNER: Dev 2. A negated claim must never be merged with (deduplicated into) its positive counterpart,
// and adding polarity to the dedupe key must not change any existing (non-negated) claim id.
import { describe, expect, it } from "vitest";
import { parseClaimsResponse, type ClaimWire } from "@/lib/truth/claims";
import { isNegated } from "@/lib/truth/text";

const T = "The forklift touched the worker at about 3 seconds. The forklift never touched the worker at about 3 seconds.";
const st = (text: string): ClaimWire => ({ text, actor: "", object: "forklift", actionKind: "state", stateValue: "touched the worker", timeKind: "approx", t: 3, hedged: false });
const POS = st("The forklift touched the worker at about 3 seconds");
const NEG = st("The forklift never touched the worker at about 3 seconds");

describe("negated claims and deduplication", () => {
  it("keeps a positive and a negated claim with the same structure as two claims", () => {
    const r = parseClaimsResponse({ claims: [POS, NEG] }, T, "s1");
    expect(r.rejected).toEqual([]);
    expect(r.claims.map((c) => c.text)).toEqual([POS.text, NEG.text]);
    expect(new Set(r.claims.map((c) => c.id)).size).toBe(2);
  });

  it("the positive claim's id is unchanged by the polarity rule", () => {
    const alone = parseClaimsResponse({ claims: [POS] }, T, "s1").claims[0]!.id;
    expect(parseClaimsResponse({ claims: [POS, NEG] }, T, "s1").claims[0]!.id).toBe(alone);
  });

  it("two identical negated claims are still deduplicated", () => {
    const r = parseClaimsResponse({ claims: [NEG, { ...NEG, text: "The forklift never touched the worker" }] }, T, "s1");
    expect(r.claims).toHaveLength(1);
    expect(r.rejected[0]!.reason).toMatch(/duplicate/);
  });
});

describe("isNegated", () => {
  it.each(["never touched", "did not touch", "didn't touch", "didn’t touch", "wasn't there", "touched nobody", "No, it stopped", "without stopping", "neither one"])(
    "detects %s",
    (s) => expect(isNegated(s)).toBe(true),
  );
  it.each(["touched the worker", "near the north wall", "nothing", "knotted rope", "the notch", "a nonstop forklift", "cannot"])("is word-level: %s", (s) => {
    const expected = s === "nothing" || s === "cannot";
    expect(isNegated(s)).toBe(expected);
  });
});

describe("persistent and temporally ordered claims are not merged with their plain twins", () => {
  const T2 = "The forklift was clear of the worker. The forklift stayed clear of the worker. The forklift stopped. The forklift stopped before reaching the worker.";
  const s2 = (text: string, stateValue: string): ClaimWire => ({ text, actor: "", object: "forklift", actionKind: "state", stateValue, timeKind: "none", hedged: false });
  const PLAIN_CLEAR = s2("The forklift was clear of the worker", "clear of the worker");
  const STAYED = s2("The forklift stayed clear of the worker", "clear of the worker");
  const PLAIN_STOP = s2("The forklift stopped", "stopped");
  const BEFORE = s2("The forklift stopped before reaching the worker", "stopped");

  it("keeps all four claims, with distinct ids", () => {
    const r = parseClaimsResponse({ claims: [PLAIN_CLEAR, STAYED, PLAIN_STOP, BEFORE] }, T2, "s1", { durationS: 10 });
    expect(r.rejected).toEqual([]);
    expect(r.claims.map((c) => c.text)).toEqual([PLAIN_CLEAR.text, STAYED.text, PLAIN_STOP.text, BEFORE.text]);
    expect(new Set(r.claims.map((c) => c.id)).size).toBe(4);
  });

  it("plain claims keep their ids", () => {
    const alone = parseClaimsResponse({ claims: [PLAIN_CLEAR, PLAIN_STOP] }, T2, "s1", { durationS: 10 }).claims.map((c) => c.id);
    const mixed = parseClaimsResponse({ claims: [PLAIN_CLEAR, STAYED, PLAIN_STOP, BEFORE] }, T2, "s1", { durationS: 10 }).claims;
    expect([mixed[0]!.id, mixed[2]!.id]).toEqual(alone);
  });
});
