// OWNER: Dev 1.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { countIds, idsFor, maskCounts, parseNpyHeader, HAS_UNZIP } from "@/lib/capture/sdgMasks";
import { HAS_ZIP, npy, writeNpz } from "@/lib/capture/sdgFixture";

const key = (r: number, g: number, b: number, a: number) => `(${r}, ${g}, ${b}, ${a})`;

describe("parseNpyHeader", () => {
  it("reads shape and data offset of a uint8 C-order array", () => {
    const h = parseNpyHeader(npy([3, 2, 4, 4], new Uint8Array(96)));
    expect(h).toEqual({ shape: [3, 2, 4, 4], dataOffset: 128 });
  });
  it("needs only the first bytes", () => {
    expect(parseNpyHeader(npy([1, 1, 1, 4], new Uint8Array(4)).subarray(0, 130)).dataOffset).toBe(128);
  });
  it("rejects other dtypes or Fortran order", () => {
    const bad = Buffer.from(npy([1, 1, 1, 4], new Uint8Array(4)).toString("latin1").replace("|u1", "<f4"), "latin1");
    expect(() => parseNpyHeader(bad)).toThrow(/uint8/);
  });
});

describe("idsFor and countIds", () => {
  const line = JSON.stringify({
    [key(1, 0, 0, 255)]: "/World/Characters/Worker/Worker_0/shirt",
    [key(2, 0, 0, 255)]: "/World/Characters/Worker/Worker_0/pants",
    [key(0, 1, 0, 255)]: "/World/Robots/forklift/Forklift/lift",
    [key(9, 9, 9, 255)]: "INVALID",
  });
  it("collects the instance ids (R + G*256 + B*65536 + A*2^24) under a path prefix", () => {
    expect([...idsFor(line, "/World/Characters/")].sort()).toEqual([1 + 255 * 2 ** 24, 2 + 255 * 2 ** 24].sort());
    expect([...idsFor(line, "/World/Robots/")]).toEqual([256 + 255 * 2 ** 24]);
  });
  it("counts pixels whose RGBA bytes match", () => {
    const px = Buffer.from([1, 0, 0, 255, 2, 0, 0, 255, 0, 1, 0, 255, 0, 0, 0, 0]);
    expect(countIds(px, idsFor(line, "/World/Characters/"))).toBe(2);
    expect(countIds(px, idsFor(line, "/World/Robots/"))).toBe(1);
  });
});

const dir = mkdtempSync(path.join(tmpdir(), "rashomon-masks-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!HAS_ZIP || !HAS_UNZIP)("maskCounts", () => {
  it("streams the npz and counts each entity's pixels in the requested frames only", async () => {
    // 3 frames of 2x4 pixels. Frame i has i worker pixels and 1 forklift pixel.
    const [T, H, W] = [3, 2, 4];
    const data = new Uint8Array(T * H * W * 4);
    for (let f = 0; f < T; f++) {
      const base = f * H * W * 4;
      for (let p = 0; p < f; p++) data.set([1, 0, 0, 255], base + p * 4);
      data.set([0, 1, 0, 255], base + 7 * 4);
    }
    const npz = path.join(dir, "cam.instance_id_segmentation.npz");
    writeNpz(npz, [T, H, W, 4], data);
    const map = JSON.stringify({ [key(1, 0, 0, 255)]: "/World/Characters/W/x", [key(0, 1, 0, 255)]: "/World/Robots/forklift/F" });
    const mapping = path.join(dir, "cam.instance_id_segmentation_mapping.jsonl");
    writeFileSync(mapping, `${map}\n${map}\n${map}\n`);

    const res = await maskCounts(npz, mapping, [0, 2], { worker: "/World/Characters/", forklift: "/World/Robots/" });
    expect(res.width).toBe(W);
    expect(res.height).toBe(H);
    expect(res.frames).toBe(T);
    expect(res.counts.get(0)).toEqual({ worker: 0, forklift: 1 });
    expect(res.counts.get(2)).toEqual({ worker: 2, forklift: 1 });
    expect(res.counts.has(1)).toBe(false);
  });

  it("fails on a frame index past the end", async () => {
    const npz = path.join(dir, "cam.instance_id_segmentation.npz");
    const mapping = path.join(dir, "cam.instance_id_segmentation_mapping.jsonl");
    await expect(maskCounts(npz, mapping, [5], { worker: "/World/Characters/" })).rejects.toThrow(/frame 5/);
  });
});
