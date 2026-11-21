// OWNER: Dev 1.
import { describe, expect, it } from "vitest";
import { HAS_FFMPEG } from "@/lib/video/testing";

describe("HAS_FFMPEG", () => {
  it("is a boolean", () => {
    expect(typeof HAS_FFMPEG).toBe("boolean");
  });
});
