// OWNER: Dev 3. Answer-key guard: data/labels/ holds ground truth. Nothing in the agent, pipeline or API code
// may read it. (1) A static scan of the source for any string that names a labels path. (2) Runtime: the scene
// store refuses every path out of the scene folder, so data/labels can't be reached through it.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ROOT = process.cwd();
/** Code that runs agents, the pipeline or the API. Test files are left out: some plant answer-key files on purpose. */
const SCANNED = ["lib/agent", "lib/pipeline", "lib/api", "app/api"];

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(rel)));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** String literals in the source that name a labels path: "labels", "labels/…", "…/labels", "data/labels/…". */
function labelsPathLiterals(source: string): string[] {
  const hits: string[] = [];
  const literal = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  for (const m of source.matchAll(literal)) {
    if (/(^|[/\\])labels([/\\]|$)/.test(m[2]!)) hits.push(m[0]);
  }
  return hits;
}

describe("answer-key guard: static scan", () => {
  it("the detector flags labels paths and ignores prose about labels", () => {
    expect(labelsPathLiterals(`readJson(id, "labels/gt.json")`)).toEqual([`"labels/gt.json"`]);
    expect(labelsPathLiterals(`path.join(DATA_DIR, 'labels')`)).toEqual([`'labels'`]);
    expect(labelsPathLiterals("readFile(`data/labels/${id}.json`)")).toEqual(["`data/labels/${id}.json`"]);
    expect(labelsPathLiterals(`readFile("./data\\\\labels\\\\x.json")`)).toHaveLength(1);
    expect(labelsPathLiterals(`"You never decide labels."; "labelsDone"; "relabels/x"`)).toEqual([]);
  });

  it("nothing under lib/agent, lib/pipeline, lib/api or app/api names a labels path", async () => {
    const files = (await Promise.all(SCANNED.map(sourceFiles))).flat();
    expect(files.length).toBeGreaterThan(15); // the scan really looked at the code
    const offenders: string[] = [];
    for (const f of files) {
      for (const hit of labelsPathLiterals(await readFile(path.join(ROOT, f), "utf8"))) offenders.push(`${f}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("answer-key guard: runtime", () => {
  let dataDir: string;
  const prev = process.env.DATA_DIR;
  const SECRET = "ANSWER-KEY-SECRET-7f3a";
  let store: typeof import("@/lib/store/scene");

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-guard-"));
    process.env.DATA_DIR = dataDir;
    vi.resetModules();
    store = await import("@/lib/store/scene");
    // The answer key, where it really lives: data/labels/, next to data/scenes/.
    await mkdir(path.join(dataDir, "labels"), { recursive: true });
    await writeFile(path.join(dataDir, "labels", "gt.json"), JSON.stringify([{ claimId: "c1", label: SECRET }]));
    await store.createScene({ split: "dev", room: "r", cameras: ["A", "B"], excludedCameras: [] }, { id: "s1" });
  });

  afterAll(async () => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    await rm(dataDir, { recursive: true, force: true });
  });

  it.each(["../../labels/gt.json", "../labels/gt.json", "stills/../../../labels/gt.json", path.join(tmpdir(), "x", "labels", "gt.json")])(
    "the scene store refuses %s",
    async (file) => {
      expect(() => store.scenePath("s1", file)).toThrow(/Invalid file/);
      await expect(store.readJson("s1", file)).rejects.toThrow(/Invalid file/);
      await expect(store.writeJson("s1", file, {})).rejects.toThrow(/Invalid file/);
      await expect(store.appendJsonl("s1", file, {})).rejects.toThrow(/Invalid file/);
    },
  );

  it.each(["..", "../labels", "labels/..", ".labels"])("the scene store refuses scene id %j", (id) => {
    expect(() => store.scenePath(id, "gt.json")).toThrow(/Invalid scene id/);
  });

  it("a scene literally named labels is a scene folder, not the answer key", async () => {
    expect(store.scenePath("labels", "gt.json")).toBe(path.join(dataDir, "scenes", "labels", "gt.json"));
    await expect(store.readJson("labels", "gt.json")).rejects.toThrow(/not found/);
  });

  it("the agent's menu, even with the answer key on disk, never contains it", async () => {
    const { buildMenu } = await import("@/lib/agent/menu");
    const manifest = await store.loadManifest("s1");
    const claim = { id: "c1", sceneId: "s1", text: "t", actor: "a", object: "o", action: "put", window: [1, 3] as [number, number], timeIsPrecise: true };
    const menu = await buildMenu("investigator", claim, { claimId: "c1", verdict: "Insufficient", evidence: [], audit: null, history: [] }, manifest);
    expect(JSON.stringify(menu)).not.toContain(SECRET);
  });
});
