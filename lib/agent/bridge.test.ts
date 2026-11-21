// OWNER: Dev 3. Tests for the bridge's validation rules and tool-call schemas.
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/config";
import type { AgentMenu, Claim, InspectWindowArgs } from "@/lib/types";
import {
  findOverlap,
  InspectWindowArgsSchema,
  parseToolCall,
  StopArgsSchema,
  validate,
  validateWindow,
} from "@/lib/agent/bridge";

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
      const wide = menu({ claim: { ...claim, window: [5, 20] } }); // claim window = range, to isolate this rule
      expect(validate(args({ start_s: 5, end_s: 6 }), wide).ok).toBe(true);
      expect(validate(args({ start_s: 16, end_s: 20 }), wide).ok).toBe(true);
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
      const wide = { ...checked, claim: { ...claim, window: [5, 20] as [number, number] } };
      expect(validate(args({ start_s: 12, end_s: 14 }), wide).ok).toBe(true);
      expect(validate(args({ start_s: 8, end_s: 10 }), wide).ok).toBe(true);
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

describe("claim window overlap", () => {
  // claim.window is [10, 14]; allowedRangeS is [5, 20] (the claim window plus padding).
  it("rejects a clip entirely before or after the claim window, naming it", () => {
    expect(reasonOf(validate(args({ start_s: 5, end_s: 7 }), menu()))).toBe("Clip must overlap the claim window 10–14 s.");
    expect(reasonOf(validate(args({ start_s: 16, end_s: 19 }), menu()))).toBe("Clip must overlap the claim window 10–14 s.");
  });

  it("rejects a clip that only touches the claim window", () => {
    expect(validate(args({ start_s: 8, end_s: 10 }), menu()).ok).toBe(false);
    expect(validate(args({ start_s: 14, end_s: 16 }), menu()).ok).toBe(false);
  });

  it("accepts a clip that extends into the padding on either side", () => {
    expect(validate(args({ start_s: 7, end_s: 10.5 }), menu()).ok).toBe(true);
    expect(validate(args({ start_s: 13.5, end_s: 17 }), menu()).ok).toBe(true);
  });

  it("formats fractional claim windows", () => {
    const m = menu({ claim: { ...claim, window: [9.5, 12] } });
    expect(reasonOf(validate(args({ start_s: 5, end_s: 7 }), m))).toBe("Clip must overlap the claim window 9.5–12 s.");
  });

  it("is part of validateWindow()", () => {
    expect(validateWindow(args({ start_s: 5, end_s: 7 }), menu())).toEqual({
      ok: false,
      reason: "Clip must overlap the claim window 10–14 s.",
    });
  });
});

describe("validateWindow", () => {
  it("accepts a valid window", () => {
    expect(validateWindow(args(), menu())).toEqual({ ok: true });
  });

  it("ignores follow-ups and already-checked windows", () => {
    const m = menu({ followUpsLeft: 0, alreadyChecked: [{ camera: "A", window: [10, 12] }] });
    expect(validateWindow(args(), m)).toEqual({ ok: true });
  });

  it.each([
    ["excluded camera", { camera_id: "D" as const }],
    ["outside range", { start_s: 19, end_s: 21 }],
    ["too short", { start_s: 10, end_s: 10.5 }],
    ["too long", { start_s: 10, end_s: 15 }],
    ["NaN", { start_s: Number.NaN }],
  ])("rejects %s", (_name, bad) => {
    expect(validateWindow(args(bad), menu()).ok).toBe(false);
  });
});

describe("findOverlap", () => {
  const checked = [
    { camera: "A" as const, window: [10, 12] as [number, number] },
    { camera: "B" as const, window: [0, 2] as [number, number] },
  ];

  it("finds an overlapping window on the same camera", () => {
    expect(findOverlap("A", [11, 13], checked)).toEqual(checked[0]);
  });

  it("ignores touching windows and other cameras", () => {
    expect(findOverlap("A", [12, 14], checked)).toBeUndefined();
    expect(findOverlap("B", [10, 12], checked)).toBeUndefined();
  });
});

describe("parseToolCall", () => {
  it("parses inspect_window with no dropped fields", () => {
    expect(parseToolCall("inspect_window", args())).toEqual({
      ok: true,
      call: { name: "inspect_window", args: args() },
      droppedFields: [],
    });
  });

  it("reports unknown fields it stripped", () => {
    const parsed = parseToolCall("inspect_window", { ...args(), label: "Supported", verdict: "x" });
    expect(parsed).toEqual({
      ok: true,
      call: { name: "inspect_window", args: args() },
      droppedFields: ["label", "verdict"],
    });
  });

  it("parses stop and reports its dropped fields", () => {
    expect(parseToolCall("stop", { reason: "done", confidence: 0.9 })).toEqual({
      ok: true,
      call: { name: "stop", args: { reason: "done" } },
      droppedFields: ["confidence"],
    });
  });

  it("rejects a malformed call with a reason naming the bad field", () => {
    const parsed = parseToolCall("inspect_window", { ...args(), camera_id: "Z", extra: 1 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/camera_id/);
    expect(parsed.droppedFields).toEqual(["extra"]);
  });

  it("rejects an unknown tool", () => {
    const parsed = parseToolCall("set_label", { label: "Supported" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/unknown tool.*set_label/i);
  });

  it("rejects non-object arguments", () => {
    expect(parseToolCall("stop", "done")).toMatchObject({ ok: false, droppedFields: [] });
    expect(parseToolCall("stop", null)).toMatchObject({ ok: false, droppedFields: [] });
    expect(parseToolCall("stop", [])).toMatchObject({ ok: false, droppedFields: [] });
  });
});
