// OWNER: Dev 2 (New Investigation UI). Incident-window validation, bounded by the shortest uploaded recording.
import { describe, expect, it } from "vitest";
import { checkWindow } from "./NewInvestigation";

describe("checkWindow", () => {
  it("accepts a valid window, including decimal seconds", () => {
    expect(checkWindow("0", "10", 120)).toEqual({ ok: true, start: 0, end: 10 });
    expect(checkWindow("12.5", "18.25", 120)).toEqual({ ok: true, start: 12.5, end: 18.25 });
    expect(checkWindow("0", "120", 120)).toEqual({ ok: true, start: 0, end: 120 });
  });
  it.each([
    ["", "10", /start and an end/],
    ["abc", "10", /numbers/],
    ["0", "Infinity", /numbers/],
    ["-1", "10", /negative/],
    ["5", "5", /after start/],
    ["8", "3", /after start/],
    ["0", "120.5", /shortest recording/],
  ])("rejects start=%s end=%s", (a, b, msg) => {
    const r = checkWindow(a, b, 120);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
  it("is not checkable before the durations are known", () => {
    expect(checkWindow("0", "10", null)).toEqual({ ok: false, error: null });
  });
});
