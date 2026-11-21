// OWNER: Dev 1.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "rashomon-scout-"));
process.env.DATA_DIR = dataDir;

const generateJson = vi.fn();
vi.mock("@/lib/gemini/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/gemini/client")>()),
  generateJson: (...a: unknown[]) => generateJson(...a),
}));

const { buildQuestions, questionId, scout, slug } = await import("@/lib/perception/scout");
const { MODELS } = await import("@/lib/config");

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const still = path.join(dataDir, "s.jpg");
writeFileSync(still, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

describe("slug and questionId", () => {
  it("makes stable snake_case ids", () => {
    expect(slug("Red Cup!")).toBe("red_cup");
    expect(slug("  ")).toBe("object");
    expect(questionId("red_cup", "location", "C")).toBe("red_cup:location:C");
    expect(questionId("red_cup", "heldBy", "Person 1")).toBe("red_cup:heldBy:person_1");
  });
});

describe("buildQuestions", () => {
  it("asks visible, zones A-F, each holder plus none, and listed states", () => {
    const qs = buildQuestions(
      [{ id: "red_cup", description: "red cup", states: ["upright", "tipped over"] }],
      [{ id: "person_1", description: "person in a blue shirt" }],
    );
    const ids = qs.map((q) => q.id);
    expect(ids).toEqual([
      "red_cup:visible:yes",
      ...["A", "B", "C", "D", "E", "F"].map((z) => `red_cup:location:${z}`),
      "red_cup:heldBy:person_1",
      "red_cup:heldBy:none",
      "red_cup:state:upright",
      "red_cup:state:tipped_over",
    ]);
    const c = qs.find((q) => q.id === "red_cup:location:C")!;
    expect(c).toMatchObject({ entityId: "red_cup", predicate: "location", value: "C" });
    expect(c.text).toContain("red cup");
    expect(c.text).toContain("zone C");
    expect(qs.find((q) => q.id === "red_cup:heldBy:person_1")!.text).toContain("blue shirt");
  });
});

describe("scout", () => {
  beforeEach(() => generateJson.mockReset());

  it("calls Hydrogen with the stills, dedupes ids, caps counts and writes the files", async () => {
    generateJson.mockResolvedValue({
      entities: [
        { id: "Red Cup", description: "red cup", color: "red", states: ["upright", "tipped over", "a", "b"] },
        { id: "red_cup", description: "second red cup with a chip" },
        ...Array.from({ length: 10 }, (_, i) => ({ id: `thing ${i}`, description: `thing ${i}` })),
      ],
      people: [{ id: "p1", description: "person in blue" }],
    });
    const { entities, questions } = await scout([still], "s1");
    expect(entities).toHaveLength(8);
    expect(entities.slice(0, 2).map((e) => e.id)).toEqual(["red_cup", "red_cup_2"]);
    expect(entities[0]).toMatchObject({ description: "red cup", color: "red" });
    expect(entities[0]).not.toHaveProperty("states");
    expect(questions.filter((q) => q.entityId === "red_cup" && q.predicate === "state")).toHaveLength(3);

    const [model, parts, , ctx] = generateJson.mock.calls[0]!;
    expect(model).toBe(MODELS.SCOUT);
    expect(parts.some((p: { kind: string; mimeType?: string }) => p.kind === "media" && p.mimeType === "image/jpeg")).toBe(true);
    expect(ctx).toEqual({ purpose: "scout", sceneId: "s1" });

    const dir = path.join(dataDir, "scenes", "s1");
    expect(JSON.parse(readFileSync(path.join(dir, "entities.json"), "utf8"))).toHaveLength(8);
    expect(JSON.parse(readFileSync(path.join(dir, "questions.json"), "utf8"))).toHaveLength(questions.length);
  });

  it("needs at least one still", async () => {
    await expect(scout([], "s1")).rejects.toThrow();
  });
});
