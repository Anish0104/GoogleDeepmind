// OWNER: Dev 2. Tests for interval helpers used by verdict() and evidence.
import { describe, expect, it } from "vitest";
import { covers, overlaps } from "@/lib/inference/window";

describe("overlaps", () => {
  it("is true for intervals that share a positive-length span", () => {
    expect(overlaps([0, 5], [4, 10])).toBe(true);
    expect(overlaps([4, 10], [0, 5])).toBe(true);
    expect(overlaps([2, 3], [0, 10])).toBe(true);
  });

  it("is false for disjoint intervals", () => {
    expect(overlaps([0, 2], [3, 5])).toBe(false);
    expect(overlaps([3, 5], [0, 2])).toBe(false);
  });

  it("is false for intervals that only touch at an endpoint", () => {
    expect(overlaps([0, 2], [2, 4])).toBe(false);
    expect(overlaps([2, 4], [0, 2])).toBe(false);
  });

  it("treats a zero-length interval as a point that overlaps when contained", () => {
    expect(overlaps([3, 3], [0, 5])).toBe(true);
    expect(overlaps([0, 5], [5, 5])).toBe(true);
    expect(overlaps([6, 6], [0, 5])).toBe(false);
    expect(overlaps([2, 2], [2, 2])).toBe(true);
  });

  it("normalises reversed intervals", () => {
    expect(overlaps([5, 0], [4, 10])).toBe(true);
  });
});

describe("covers", () => {
  it("is true when one interval spans the target", () => {
    expect(covers([[0, 10]], [2, 8])).toBe(true);
  });

  it("is true when contiguous intervals chain across the target in any order", () => {
    expect(covers([[5, 10], [0, 3], [3, 5]], [0, 10])).toBe(true);
  });

  it("is true when overlapping intervals chain across the target", () => {
    expect(covers([[0, 4], [3, 7], [6, 10]], [0, 10])).toBe(true);
  });

  it("is false when there is a gap in the middle", () => {
    expect(covers([[0, 4], [5, 10]], [0, 10])).toBe(false);
  });

  it("is false when the start or the end is uncovered", () => {
    expect(covers([[1, 10]], [0, 10])).toBe(false);
    expect(covers([[0, 9]], [0, 10])).toBe(false);
  });

  it("is false with no intervals", () => {
    expect(covers([], [0, 10])).toBe(false);
  });

  it("ignores intervals outside the target", () => {
    expect(covers([[20, 30], [0, 10]], [0, 10])).toBe(true);
    expect(covers([[20, 30]], [0, 10])).toBe(false);
  });

  it("tolerates floating-point seams between slices", () => {
    expect(covers([[0, 0.1 + 0.2], [0.3, 1]], [0, 1])).toBe(true);
  });

  it("covers a zero-length target when an interval contains the point", () => {
    expect(covers([[0, 5]], [3, 3])).toBe(true);
    expect(covers([[0, 2]], [3, 3])).toBe(false);
  });
});
