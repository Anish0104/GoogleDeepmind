// OWNER: Dev 4.
import { describe, expect, it } from "vitest";
import { fakeCtx } from "./fakeCtx";

describe("fakeCtx", () => {
  it("records method calls and keeps assigned properties", () => {
    const { ctx, calls } = fakeCtx();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1, 1);
    expect(ctx.fillStyle).toBe("#fff");
    expect(calls).toEqual(["fillRect"]);
  });
});
