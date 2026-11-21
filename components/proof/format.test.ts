// OWNER: Dev 4.
import { describe, expect, it } from "vitest";
import { clipSrc, clockTime } from "./format";

describe("proof formatting", () => {
  it("builds clip URLs", () => {
    expect(clipSrc("demo-001", "clip-c2-C")).toBe("/clips/demo-001/clip-c2-C.webm");
    expect(clipSrc("a b", "c/d")).toBe("/clips/a%20b/c%2Fd.webm");
  });

  it("formats history times", () => {
    expect(clockTime("2026-11-21T15:31:02Z")).toBe("15:31:02");
    expect(clockTime("later")).toBe("later");
  });
});
