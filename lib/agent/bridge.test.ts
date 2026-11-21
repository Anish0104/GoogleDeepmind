// OWNER: Dev 3. Tests for the bridge's validation rules and tool-call schemas.
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/config";
import type { AgentMenu, Claim, InspectWindowArgs } from "@/lib/types";
import { InspectWindowArgsSchema, StopArgsSchema, validate } from "@/lib/agent/bridge";

const claim: Claim = {
  id: "c1",
  sceneId: "s1",
  text: "I put the red cup in zone C",
  actor: "speaker",
  object: "red cup",
  action: "place",
  window: [10, 14],
  timeIsPrecise: false,
};

function menu(overrides: Partial<AgentMenu> = {}): AgentMenu {
  return {
    agent: "investigator",
    claim,
    currentVerdict: "Insufficient",
    evidence: [],
    views: [],
    stillIds: {},
    includedCameras: ["A", "B", "C"],
    allowedRangeS: [5, 20],
    alreadyChecked: [],
    followUpsLeft: 2,
    ...overrides,
  };
}

function args(overrides: Partial<InspectWindowArgs> = {}): InspectWindowArgs {
  return { camera_id: "A", start_s: 10, end_s: 12, crop: "full", reason: "side view of zone C", ...overrides };
}

function reasonOf(v: ReturnType<typeof validate>): string {
  if (v.ok) throw new Error("expected a rejection");
  return v.reason;
}

describe("validate", () => {
  it("accepts a valid request", () => {
    expect(validate(args(), menu())).toEqual({ ok: true });
  });

  describe("camera", () => {
    it("rejects a camera not in includedCameras", () => {
      expect(reasonOf(validate(args({ camera_id: "D" }), menu()))).toMatch(/camera D/i);
    });

    it("rejects every camera when none are included", () => {
      expect(validate(args(), menu({ includedCameras: [] })).ok).toBe(false);
    });
  });

  describe("allowed range", () => {
    it("rejects a window starting before the range", () => {
      expect(reasonOf(validate(args({ start_s: 4, end_s: 6 }), menu()))).toMatch(/allowed range/i);
    });

    it("rejects a window ending after the range", () => {
      expect(reasonOf(validate(args({ start_s: 19, end_s: 21 }), menu()))).toMatch(/allowed range/i);
    });

    it("accepts a window exactly on the range edges", () => {
      expect(validate(args({ start_s: 5, end_s: 6 }), menu()).ok).toBe(true);
      expect(validate(args({ start_s: 16, end_s: 20 }), menu()).ok).toBe(true);
    });
  });

  describe("length", () => {
    it(`rejects a window shorter than ${LIMITS.CLIP_MIN_S} s`, () => {
      expect(reasonOf(validate(args({ start_s: 10, end_s: 10.5 }), menu()))).toMatch(/length|long/i);
    });

    it(`rejects a window longer than ${LIMITS.CLIP_MAX_S} s`, () => {
      expect(reasonOf(validate(args({ start_s: 10, end_s: 14.5 }), menu()))).toMatch(/length|long/i);
    });

    it("rejects a reversed or empty window", () => {
      expect(validate(args({ start_s: 12, end_s: 10 }), menu()).ok).toBe(false);
      expect(validate(args({ start_s: 12, end_s: 12 }), menu()).ok).toBe(false);
    });

    it("accepts exactly the min and max length", () => {
      expect(validate(args({ start_s: 10, end_s: 10 + LIMITS.CLIP_MIN_S }), menu()).ok).toBe(true);
      expect(validate(args({ start_s: 10, end_s: 10 + LIMITS.CLIP_MAX_S }), menu()).ok).toBe(true);
    });

    it("tolerates float rounding at the limits", () => {
      expect(validate(args({ start_s: 10.1, end_s: 10.1 + LIMITS.CLIP_MAX_S }), menu()).ok).toBe(true);
    });
  });

  describe("already checked", () => {
    const checked = menu({ alreadyChecked: [{ camera: "A", window: [10, 12] }] });

    it("rejects an identical window on the same camera", () => {
      expect(reasonOf(validate(args(), checked))).toMatch(/already checked/i);
    });

    it("rejects a partly overlapping window on the same camera", () => {
      expect(validate(args({ start_s: 11, end_s: 13 }), checked).ok).toBe(false);
      expect(validate(args({ start_s: 9, end_s: 11 }), checked).ok).toBe(false);
      expect(validate(args({ start_s: 9, end_s: 13 }), checked).ok).toBe(false);
    });

    it("accepts a window that only touches a checked one", () => {
      expect(validate(args({ start_s: 12, end_s: 14 }), checked).ok).toBe(true);
      expect(validate(args({ start_s: 8, end_s: 10 }), checked).ok).toBe(true);
    });

    it("accepts the same window on a different camera", () => {
      expect(validate(args({ camera_id: "B" }), checked).ok).toBe(true);
    });
  });

  describe("follow-ups", () => {
    it("rejects when followUpsLeft is 0", () => {
      expect(reasonOf(validate(args(), menu({ followUpsLeft: 0 })))).toMatch(/follow-ups/i);
    });

    it("rejects when followUpsLeft is negative", () => {
      expect(validate(args(), menu({ followUpsLeft: -1 })).ok).toBe(false);
    });
  });

  it("rejects non-finite times", () => {
    expect(validate(args({ start_s: Number.NaN }), menu()).ok).toBe(false);
    expect(validate(args({ end_s: Number.POSITIVE_INFINITY }), menu()).ok).toBe(false);
  });
});

describe("InspectWindowArgsSchema", () => {
  it("parses a valid tool call", () => {
    expect(InspectWindowArgsSchema.parse(args())).toEqual(args());
  });

  it("strips unknown fields", () => {
    expect(InspectWindowArgsSchema.parse({ ...args(), label: "Supported" })).toEqual(args());
  });

  it.each([
    ["unknown camera", { camera_id: "E" }],
    ["lowercase camera", { camera_id: "a" }],
    ["string time", { start_s: "10" }],
    ["negative time", { start_s: -1 }],
    ["NaN time", { end_s: Number.NaN }],
    ["bad crop", { crop: "zoom" }],
    ["empty reason", { reason: "  " }],
  ])("rejects %s", (_name, bad) => {
    expect(InspectWindowArgsSchema.safeParse({ ...args(), ...bad }).success).toBe(false);
  });

  it("rejects missing fields", () => {
    const { reason: _r, ...noReason } = args();
    expect(InspectWindowArgsSchema.safeParse(noReason).success).toBe(false);
    expect(InspectWindowArgsSchema.safeParse(null).success).toBe(false);
  });
});

describe("StopArgsSchema", () => {
  it("parses a valid stop", () => {
    expect(StopArgsSchema.parse({ reason: "no clip could help" })).toEqual({ reason: "no clip could help" });
  });

  it("rejects a missing or empty reason", () => {
    expect(StopArgsSchema.safeParse({}).success).toBe(false);
    expect(StopArgsSchema.safeParse({ reason: "" }).success).toBe(false);
  });
});
