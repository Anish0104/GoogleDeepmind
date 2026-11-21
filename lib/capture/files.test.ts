// OWNER: Dev 1.
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-files-"));
process.env.DATA_DIR = dataDir;
const { recordingPath } = await import("@/lib/capture/files");

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("recordingPath", () => {
  const dir = path.join(dataDir, "scenes", "s1");
  mkdirSync(dir, { recursive: true });

  it("finds cam-X.webm or cam-X.mp4 (mp4 first) and returns null when missing", () => {
    expect(recordingPath("s1", "A")).toBeNull();
    writeFileSync(path.join(dir, "cam-A.webm"), "x");
    expect(recordingPath("s1", "A")).toBe(path.join(dir, "cam-A.webm"));
    writeFileSync(path.join(dir, "cam-A.mp4"), "x");
    expect(recordingPath("s1", "A")).toBe(path.join(dir, "cam-A.mp4"));
  });

  it("resolves a relative manifest entry inside the scene folder, not the working directory", () => {
    writeFileSync(path.join(dir, "cam-C.webm"), "x");
    writeFileSync(path.join(dir, "renamed-C.webm"), "x");
    expect(recordingPath("s1", "C", { C: "renamed-C.webm" })).toBe(path.join(dir, "renamed-C.webm"));
    expect(recordingPath("s1", "C", { C: "cam-C.webm" })).toBe(path.join(dir, "cam-C.webm"));
  });

  it("uses an absolute manifest entry when it exists", () => {
    const other = path.join(dataDir, "elsewhere-B.webm");
    writeFileSync(other, "x");
    expect(recordingPath("s1", "B", { B: other })).toBe(other);
  });

  it("falls back to the cam-X convention when the listed file is missing or unsafe", () => {
    writeFileSync(path.join(dir, "cam-D.webm"), "x");
    const conv = path.join(dir, "cam-D.webm");
    expect(recordingPath("s1", "D", { D: "gone.webm" })).toBe(conv);
    expect(recordingPath("s1", "D", { D: path.join(dataDir, "gone.webm") })).toBe(conv);
    expect(recordingPath("s1", "D", { D: "../../escape.webm" })).toBe(conv);
    expect(recordingPath("s1", "B", { B: "gone.webm" })).toBeNull();
  });
});
