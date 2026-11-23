// OWNER: Dev 2. The pre-model statement check: stops gibberish, accepts short or imperfect real statements.
import { describe, expect, it } from "vitest";
import { checkStatement } from "@/lib/truth/statement";

describe("checkStatement", () => {
  it.each(["", "   \n\t ", "dfdfd", "asdf", "asdf asdf asdf", "?!... ---", "zxcvb qwrtp", "kkkkk lllll", "1234 5678"])("rejects %j", (s) => {
    expect(checkStatement(s).ok).toBe(false);
  });
  it.each([
    "The forklift stopped.",
    "A worker crossed in front of the vehicle.",
    "The forklift hit the worker.",
    "forklift hit me",
    "the forklfit stoped and i jumpd back", // typos
    "The forklift moved toward the worker at around 4 seconds. The worker stepped away. The forklift did not touch the worker.",
    "It never touched me.",
    "El montacargas se detuvo.",
    "叉车撞到了工人", // other scripts are not judged by Latin vowel rules
  ])("accepts %j", (s) => {
    expect(checkStatement(s)).toEqual({ ok: true });
  });
  it("explains what to write", () => {
    const r = checkStatement("dfdfd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Describe something observable/);
  });
});
