// OWNER: Dev 1.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-views-"));
process.env.DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const generateJson = vi.fn();
vi.mock("@/lib/gemini/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/gemini/client")>()),
  generateJson: (...a: unknown[]) => generateJson(...a),
}));

const { describeViews } = await import("@/lib/perception/views");
const { createScene } = await import("@/lib/store/scene");

await createScene({ split: "dev", room: "r", cameras: ["A", "B", "C", "D"], excludedCameras: [] }, { id: "v1" });
const stills: Record<string, string> = {};
mkdirSync(path.join(dataDir, "stills"), { recursive: true });
for (const c of ["A", "B", "C"]) {
  stills[c] = path.join(dataDir, "stills", `${c}.jpg`);
  writeFileSync(stills[c]!, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
}

const reply = (cams: string[]) => ({ views: cams.map((camera) => ({ camera, text: `camera ${camera}: overhead, whole floor visible` })) });

beforeEach(() => generateJson.mockReset());

describe("describeViews", () => {
  it("asks once with every camera's still, labelled, and writes views.json as [{ camera, text }]", async () => {
    generateJson.mockResolvedValue(reply(["A", "B", "C"]));
    const views = await describeViews(stills, "v1");
    expect(generateJson).toHaveBeenCalledTimes(1);
    const [, parts, , ctx] = generateJson.mock.calls[0]!;
    const texts = (parts as { kind: string; text?: string }[]).filter((p) => p.kind === "text").map((p) => p.text).join("\n");
    for (const c of ["A", "B", "C"]) expect(texts).toContain(`Camera ${c}`);
    expect((parts as { kind: string }[]).filter((p) => p.kind === "media")).toHaveLength(3);
    expect(ctx).toMatchObject({ purpose: "views", sceneId: "v1" });
    expect(views.map((v) => v.camera)).toEqual(["A", "B", "C"]);
    const saved = JSON.parse(readFileSync(path.join(dataDir, "scenes", "v1", "views.json"), "utf8"));
    expect(saved).toEqual(views);
    expect(Object.keys(saved[0]).sort()).toEqual(["camera", "text"]);
  });

  it("tells the model to describe the viewpoint and fixed obstructions, not where people are in this frame", async () => {
    generateJson.mockResolvedValue(reply(["A", "B", "C"]));
    await describeViews(stills, "v1");
    const prompt = (generateJson.mock.calls[0]![1] as { text?: string }[])[0]!.text!;
    expect(prompt).toMatch(/height/i);
    expect(prompt).toMatch(/block|hidden/i);
    expect(prompt).toMatch(/not .*where .*(people|person|objects) .*(are|happen)/i);
    expect(prompt).toMatch(/do not identify/i);
  });

  it("rejects a reply that skips or repeats a camera, or describes one it was not shown", async () => {
    generateJson.mockResolvedValue(reply(["A", "B"]));
    await expect(describeViews(stills, "v1")).rejects.toThrow(/camera C/);
    generateJson.mockResolvedValue(reply(["A", "B", "C", "C"]));
    await expect(describeViews(stills, "v1")).rejects.toThrow(/camera C/);
    generateJson.mockResolvedValue(reply(["A", "B", "C", "D"]));
    await expect(describeViews(stills, "v1")).rejects.toThrow(/camera D/);
  });

  it("needs at least one still and fails on a missing file before any model call", async () => {
    await expect(describeViews({}, "v1")).rejects.toThrow(/at least one/);
    await expect(describeViews({ A: path.join(dataDir, "nope.jpg") }, "v1")).rejects.toThrow(/nope\.jpg/);
    expect(generateJson).not.toHaveBeenCalled();
    expect(existsSync(path.join(dataDir, "scenes", "v1", "views.json"))).toBe(true); // earlier test's file untouched
  });
});
