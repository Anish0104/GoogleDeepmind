// OWNER: Dev 2. splitClaimsDetailed() against mocked Carbon replies: valid, negated, timed and untimed claims;
// empty, malformed and partially valid replies. Malformed output is retried exactly once and never read as
// "no claims"; API failures are not retried here (generateJson() already retries transient HTTP errors).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimWire } from "@/lib/truth/claims";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
const { splitClaimsDetailed } = await import("@/lib/truth/claims");
const { ClaimExtractionError, ClaimOutputError } = await import("@/lib/truth/errors");
const gen = vi.mocked((await import("@/lib/gemini/client")).generateJson);
beforeEach(() => gen.mockReset());

const T = "The forklift moved toward the worker at around 4 seconds. The worker stepped away. The forklift did not touch the worker.";
const st = (text: string, object: string, stateValue: string, o: Partial<ClaimWire> = {}): ClaimWire => ({ text, actor: "", object, actionKind: "state", stateValue, timeKind: "none", hedged: false, ...o });
const MOVED = st("The forklift moved toward the worker at around 4 seconds", "forklift", "moved toward the worker", { timeKind: "approx", t: 4 });
const STEPPED = st("The worker stepped away", "worker", "stepped away");
const NOT_TOUCH = st("The forklift did not touch the worker", "forklift", "touch the worker");
const run = (t = T) => splitClaimsDetailed(t, "s1", { durationS: 10 });

describe("claim extraction", () => {
  it("one valid claim", async () => {
    gen.mockResolvedValueOnce({ claims: [STEPPED] });
    const r = await run();
    expect(r.claims.map((c) => c.text)).toEqual(["The worker stepped away"]);
    expect(r.rejected).toEqual([]);
  });

  it("several claims, negation kept, approximate and missing times resolved without inventing a time", async () => {
    gen.mockResolvedValueOnce({ claims: [MOVED, STEPPED, NOT_TOUCH] });
    const r = await run();
    expect(r.rejected).toEqual([]);
    expect(r.claims.map((c) => c.text)).toEqual([MOVED.text, STEPPED.text, NOT_TOUCH.text]);
    expect(r.claims[0]!.window).toEqual([1, 7]);
    expect(r.claims[0]!.timeIsPrecise).toBe(false);
    expect(r.claims[1]!.window).toEqual([0, 10]);
    expect(r.claims[2]!.text).toMatch(/did not touch/); // never turned into "touched"
  });

  it("a claim the footage may contradict is still extracted (truth is decided later)", async () => {
    gen.mockResolvedValueOnce({ claims: [st("The forklift hit the worker", "forklift", "hit the worker")] });
    const r = await run("The forklift hit the worker.");
    expect(r.claims).toHaveLength(1);
  });

  it("the model returning no claims is an empty result, not an error", async () => {
    gen.mockResolvedValueOnce({ claims: [] });
    expect(await run()).toEqual({ claims: [], rejected: [] });
  });

  it("missing required fields and invented objects are rejected with reasons; valid ones are kept", async () => {
    gen.mockResolvedValueOnce({ claims: [STEPPED, { ...STEPPED, stateValue: undefined }, st("The crane fell", "crane", "fell")] });
    const r = await run();
    expect(r.claims.map((c) => c.text)).toEqual(["The worker stepped away"]);
    expect(r.rejected.map((x) => x.index)).toEqual([1, 2]);
    expect(r.rejected[0]!.reason).toMatch(/malformed claim/);
    expect(r.rejected[1]!.reason).toMatch(/object "crane" is not in the transcript/);
  });

  it("malformed output once, then a valid reply: succeeds after exactly 2 calls", async () => {
    gen.mockRejectedValueOnce(new Error("[claims] model returned non-JSON output: {oops"));
    gen.mockResolvedValueOnce({ claims: [STEPPED] });
    expect((await run()).claims).toHaveLength(1);
    expect(gen).toHaveBeenCalledTimes(2);
  });

  it("a reply that does not match the schema twice is ClaimOutputError, never 'no claims'", async () => {
    gen.mockRejectedValueOnce(new Error("[claims] model output failed schema: claims expected array"));
    gen.mockResolvedValueOnce({ claims: "none" } as never); // passes the mock, fails the app-side envelope
    await expect(run()).rejects.toBeInstanceOf(ClaimOutputError);
    expect(gen).toHaveBeenCalledTimes(2);
  });

  it("a model/API failure is ClaimExtractionError (not output) and is not retried here", async () => {
    gen.mockRejectedValueOnce(Object.assign(new Error("403 forbidden"), { status: 403 }));
    const e = await run().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ClaimExtractionError);
    expect(e).not.toBeInstanceOf(ClaimOutputError);
    expect(gen).toHaveBeenCalledTimes(1);
  });
});
