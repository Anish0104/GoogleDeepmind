// OWNER: Dev 1.
import { describe, expect, it } from "vitest";
import {
  SDG,
  checkRun,
  footprint,
  penetration,
  parseDetections,
  polygonGap,
  sliceTruth,
  speeds,
  summarizeRun,
  trackRun,
  visibilityAnswer,
  type Box3d,
  type DetectionFrame,
  type XY,
} from "@/lib/capture/sdgTruth";

/** A box centred on (cx, cy), w along x and h along y, rotated by deg about z. Row-vector transform. */
function box(cx: number, cy: number, w: number, h: number, deg = 0): Box3d {
  const r = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return {
    x_min: -w / 2, x_max: w / 2, y_min: -h / 2, y_max: h / 2, z_min: 0, z_max: 1.6,
    transform: [[c, s, 0, 0], [-s, c, 0, 0], [0, 0, 1, 0], [cx, cy, 0, 1]],
  };
}

const frame = (worker: Box3d, forklift: Box3d): DetectionFrame => ({
  agents: {
    "/World/Characters/Worker/Worker_0/x": { label: { class: "character" }, annotators: { bounding_box_3d_fast: worker } },
    "/World/Robots/forklift/Forklift": { label: { class: "robot" }, annotators: { bounding_box_3d_fast: forklift } },
  },
});

const close = (a: XY, b: XY) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe("footprint", () => {
  it("applies the row-vector transform (rotation rows, translation in the last row)", () => {
    const f = footprint(box(5, 0, 2, 1, 90));
    const xs = f.map((p) => p[0]);
    const ys = f.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(4.5, 6);
    expect(Math.max(...xs)).toBeCloseTo(5.5, 6);
    expect(Math.min(...ys)).toBeCloseTo(-1, 6);
    expect(Math.max(...ys)).toBeCloseTo(1, 6);
  });
});

describe("polygonGap", () => {
  const unit: XY[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  it("is the edge-to-edge distance for separate boxes", () => {
    expect(polygonGap(unit, [[2, 0], [3, 0], [3, 1], [2, 1]])).toBeCloseTo(1, 9);
  });
  it("is 0 when the boxes overlap or one contains the other", () => {
    expect(polygonGap(unit, [[0.5, 0.5], [2, 0.5], [2, 2], [0.5, 2]])).toBe(0);
    expect(polygonGap([[-1, -1], [3, -1], [3, 3], [-1, 3]], unit)).toBe(0);
  });
  it("handles rotated boxes (vertex towards an edge)", () => {
    expect(polygonGap(unit, footprint(box(2, 0.5, 1, 1, 45)))).toBeCloseTo(2 - Math.SQRT1_2 - 1, 9);
  });
  it("is 0 for crossing boxes with no corner inside the other", () => {
    expect(polygonGap([[0, 0.4], [3, 0.4], [3, 0.6], [0, 0.6]], [[1.4, -1], [1.6, -1], [1.6, 2], [1.4, 2]])).toBe(0);
  });
});

describe("parseDetections", () => {
  it("validates each line and ignores fields it does not need", () => {
    const line = JSON.stringify({ ...frame(box(0, 0, 0.5, 0.5), box(3, 0, 2, 1)), objects: {} });
    const frames = parseDetections(`${line}\n${line}\n`);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.agents["/World/Robots/forklift/Forklift"]!.label.class).toBe("robot");
  });
  it("rejects a line without a 3D box", () => {
    const bad = JSON.stringify({ agents: { a: { label: { class: "robot" }, annotators: {} } } });
    expect(() => parseDetections(bad)).toThrow(/line 1/);
  });
});

/** Worker stands at the origin; forklift drives along x at 0.75 m/s from x0, 30 fps, n frames. */
function approach(n: number, x0: number, dodgeAt?: number): DetectionFrame[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / SDG.FPS;
    const wy = dodgeAt !== undefined && t > dodgeAt ? (t - dodgeAt) * 2 : 0; // dodge sideways at 2 m/s
    return frame(box(0, wy, 0.5, 0.5), box(x0 - 0.75 * t, 0, 2, 1));
  });
}

describe("trackRun and speeds", () => {
  it("tracks worker, forklift and the footprint gap per frame", () => {
    const tr = trackRun(approach(31, 4));
    expect(tr).toHaveLength(31);
    expect(tr[0]!.t).toBe(0);
    close(tr[0]!.forklift, [4, 0]);
    expect(tr[0]!.gapM).toBeCloseTo(4 - 1 - 0.25, 9);
    expect(tr[30]!.t).toBeCloseTo(1, 9);
  });
  it("needs exactly one worker and one forklift", () => {
    const f = approach(1, 4)[0]!;
    const noRobot: DetectionFrame = { agents: { w: f.agents["/World/Characters/Worker/Worker_0/x"]! } };
    expect(() => trackRun([noRobot])).toThrow(/forklift/);
  });
  it("measures speed in m/s", () => {
    const v = speeds(trackRun(approach(30, 4)), "forklift");
    expect(v[15]).toBeCloseTo(0.75, 6);
  });
});

describe("summarizeRun", () => {
  it("calls a deep footprint overlap contact and finds when it starts and ends", () => {
    const s = summarizeRun(trackRun(approach(300, 4)));
    expect(s.outcome).toBe("contact");
    expect(s.minGapM).toBe(0);
    expect(s.maxOverlapM).toBeGreaterThan(0.4);
    // front edge x = 3 - 0.75t; the worker (x in [-0.25, 0.25]) is fully over the forklift, overlap 0.5, once 3 - 0.75t <= -0.25
    expect(s.contact![0]).toBeCloseTo(4.333, 1);
    expect(s.durationS).toBeCloseTo(10, 9);
    expect(s.dodgeStartT).toBeNull();
  });
  it("gives when the forklift was within NEAR_M of the worker", () => {
    const s = summarizeRun(trackRun(approach(300, 4)));
    // gap = 2.75 - 0.75t reaches 1.0 at t = 2.333 s; the forklift's back clears the worker after 7 s
    expect(s.near![0]).toBeCloseTo(2.333, 1);
    expect(s.near![1]).toBeGreaterThan(7);
  });
  it("finds the first time the forklift stays still for half a second, or null if it never stops", () => {
    expect(summarizeRun(trackRun(approach(300, 4))).forkliftStopT).toBeNull();
    const stops = Array.from({ length: 90 }, (_, i) => {
      const t = Math.min(i / SDG.FPS, 1); // drives for 1 s, then parks
      return frame(box(0, 0, 0.5, 0.5), box(4 - 0.75 * t, 0, 2, 1));
    });
    const s = summarizeRun(trackRun(stops));
    expect(s.forkliftStopT!).toBeGreaterThan(0.95);
    expect(s.forkliftStopT!).toBeLessThan(1.1);
  });
  it("calls a dodge that keeps a gap a near miss and times the dodge", () => {
    const s = summarizeRun(trackRun(approach(300, 4, 2)));
    expect(s.outcome).toBe("near_miss");
    expect(s.contact).toBeNull();
    expect(s.minGapM).toBeGreaterThanOrEqual(SDG.NEAR_MISS_MIN_GAP_M);
    expect(s.dodgeStartT!).toBeGreaterThan(1.9);
    expect(s.dodgeStartT!).toBeLessThan(2.2);
  });
});

describe("penetration", () => {
  const unit: XY[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  it("is how far two footprints overlap along their thinnest overlapping axis", () => {
    expect(penetration(unit, [[0.8, 0], [2, 0], [2, 1], [0.8, 1]])).toBeCloseTo(0.2, 9);
    expect(penetration(unit, [[0.5, 0.9], [1.5, 0.9], [1.5, 2], [0.5, 2]])).toBeCloseTo(0.1, 9);
  });
  it("is 0 or less for footprints that do not overlap", () => {
    expect(penetration(unit, [[2, 0], [3, 0], [3, 1], [2, 1]])).toBeLessThanOrEqual(0);
  });
});

describe("contact needs a clear overlap; shallow ones are unclear", () => {
  /** Forklift drives along x, stops so its front edge overlaps the worker's footprint by `depth` m, then reverses. */
  function brush(depth: number): DetectionFrame[] {
    return Array.from({ length: 300 }, (_, i) => {
      const t = i / SDG.FPS;
      const closest = 1 + 0.25 - depth; // forklift centre x when its front edge (cx - 1) is `depth` into [-0.25, 0.25]
      const cx = closest + Math.abs(t - 5) * 0.5;
      return frame(box(0, 0, 0.5, 0.5), box(cx, 0, 2, 1));
    });
  }
  it("a 10 cm overlap is unclear, not contact", () => {
    const s = summarizeRun(trackRun(brush(0.1)));
    expect(s.outcome).toBe("unclear");
    expect(s.contact).toBeNull();
    const at5 = sliceTruth(trackRun(brush(0.1))).find((x) => x.t === 5)!;
    expect(at5.answers["forklift:state:touching_worker"]).toBe("unclear");
  });
  it("a 30 cm overlap is still unclear (boxes are looser than the bodies)", () => {
    expect(summarizeRun(trackRun(brush(0.3))).outcome).toBe("unclear");
  });
  it("the forklift running fully over the worker's footprint for several frames is contact, and its slice says touching", () => {
    const s = summarizeRun(trackRun(brush(0.6)));
    expect(s.outcome).toBe("contact");
    expect(sliceTruth(trackRun(brush(0.6))).find((x) => x.t === 5)!.answers["forklift:state:touching_worker"]).toBe("yes");
  });
  it("a 5 cm gap is unclear; a gap of NEAR_MISS_MIN_GAP_M or more the whole time is a near miss", () => {
    expect(summarizeRun(trackRun(brush(-0.05))).outcome).toBe("unclear");
    expect(summarizeRun(trackRun(brush(-0.2))).outcome).toBe("near_miss");
  });
});

describe("checkRun", () => {
  it("rejects a run whose worker starts on or against the forklift (e.g. its driver)", () => {
    const riding = Array.from({ length: 60 }, (_, i) => frame(box(1 - i / 60, 0, 0.5, 0.5), box(1 - i / 60, 0, 2, 1)));
    expect(checkRun(trackRun(riding))).toMatch(/starts on or against the forklift/);
  });
  it("accepts a normal approach", () => {
    expect(checkRun(trackRun(approach(300, 4)))).toBeNull();
  });
});

describe("sliceTruth", () => {
  const truth = sliceTruth(trackRun(approach(300, 4)));
  it("covers the run in 0.5 s slices", () => {
    expect(truth).toHaveLength(20);
    expect(truth.map((s) => s.t).slice(0, 3)).toEqual([0, 0.5, 1]);
  });
  it("answers near and touching from the closest point in the slice (it happens at any time in the clip)", () => {
    const at = (t: number) => truth.find((s) => s.t === t)!;
    expect(at(0).answers["forklift:state:near_worker"]).toBe("no"); // gap 2.75..2.4
    expect(at(0).answers["forklift:state:touching_worker"]).toBe("no");
    expect(at(1.5).answers["forklift:state:near_worker"]).toBe("unclear"); // closest 1.275, between NEAR_M and FAR_M
    expect(at(2).answers["forklift:state:near_worker"]).toBe("yes"); // closest 0.9
    expect(at(4.5).answers["forklift:state:touching_worker"]).toBe("yes"); // contact starts at 4.33 s
    expect(at(3.5).answers["forklift:state:touching_worker"]).toBe("unclear"); // overlapping, but not deep enough yet
    expect(at(3).answers["forklift:state:touching_worker"]).toBe("unclear"); // closest 0.125: under CLEAR_M, no deep overlap
  });
  it("answers motion questions over the 2 s context window (one slice before, two after)", () => {
    expect(truth[4]!.answers["forklift:state:moving"]).toBe("yes");
    expect(truth[4]!.answers["worker:state:dodging"]).toBe("no");
    expect(truth[4]!.window).toEqual([1.5, 3.5]);
    expect(truth[0]!.window).toEqual([0, 1.5]);
  });
  it("says the forklift is not moving when it stands still", () => {
    const parked = Array.from({ length: 60 }, () => frame(box(0, 0, 0.5, 0.5), box(4, 0, 2, 1)));
    expect(sliceTruth(trackRun(parked))[1]!.answers["forklift:state:moving"]).toBe("no");
  });
});

describe("visibilityAnswer", () => {
  const total = 1920 * 1080;
  it("is yes above the visible floor, no below the hidden ceiling, unclear between", () => {
    expect(visibilityAnswer(5000, total)).toBe("yes");
    expect(visibilityAnswer(0, total)).toBe("no");
    expect(visibilityAnswer(800, total)).toBe("unclear");
  });
  it("scales with resolution", () => {
    expect(visibilityAnswer(5000 / 4, total / 4)).toBe("yes");
  });
});
