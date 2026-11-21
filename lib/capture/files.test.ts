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

  it("prefers the manifest's file entry when it exists on disk", () => {
    const other = path.join(dir, "other.webm");
    writeFileSync(other, "x");
    expect(recordingPath("s1", "B", { B: other })).toBe(other);
    expect(recordingPath("s1", "B", { B: path.join(dir, "gone.webm") })).toBeNull();
  });
});
