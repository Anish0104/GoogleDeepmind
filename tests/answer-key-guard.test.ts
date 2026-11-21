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

describe("answer-key guard: the warehouse eval is the only new reader of data/labels", () => {
  /** Existing files that touch data/labels, with why; any other file naming a labels path fails. */
  const KNOWN_LABELS_USERS: Record<string, string> = {
    "lib/capture/assembly101.ts": "Dev 1: WRITES the Assembly101 answer key (<sceneId>.labels.json); never reads it",
    "lib/capture/sdgWarehouse.ts": "Dev 1: writes the answer key and exports readSdgTruth() for kill test A",
    "scripts/killtests/a.ts": "Dev 1: kill test A, an evaluation script, reads the SDG answer keys (via readSdgTruth()) to score the grid",
    "app/label/actions.ts": "Dev 4: the human labelling tool reads/writes its own <sceneId>__<labeler>.json files",
    "eval/report.ts": "Dev 4: the results report reads the merged human labels (<sceneId>.json)",
  };
  const isEvalReader = (f: string) => f.startsWith(`scripts${path.sep}eval${path.sep}`);

  async function allSources(dirs: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const d of dirs) {
      try {
        out.push(...(await sourceFiles(d)));
      } catch {
        /* folder absent */
      }
    }
    return out;
  }

  it("nothing in lib/ or app/ imports scripts/eval", async () => {
    const files = await allSources(["lib", "app"]);
    expect(files.length).toBeGreaterThan(40);
    const offenders: string[] = [];
    for (const f of files) {
      const src = await readFile(path.join(ROOT, f), "utf8");
      if (/from\s+["'](?:@\/|(?:\.\.?\/)+)scripts\/eval|import\(\s*["'](?:@\/|(?:\.\.?\/)+)scripts\/eval/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("only scripts/eval (plus the known files above) names a labels path anywhere in the source", async () => {
    const files = await allSources(["lib", "app", "scripts", "eval", "components"]);
    const offenders: string[] = [];
    for (const f of files) {
      if (isEvalReader(f) || f in KNOWN_LABELS_USERS) continue;
      const hits = labelsPathLiterals(await readFile(path.join(ROOT, f), "utf8"));
      if (hits.length) offenders.push(`${f}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the eval does read the answer key (so the allowance above is real), and the known users still exist", async () => {
    const truth = await readFile(path.join(ROOT, "scripts/eval/truth.ts"), "utf8");
    expect(labelsPathLiterals(truth).length).toBeGreaterThan(0);
    for (const f of Object.keys(KNOWN_LABELS_USERS)) {
      expect(labelsPathLiterals(await readFile(path.join(ROOT, f), "utf8")).length, f).toBeGreaterThan(0);
    }
  });
});

/** Source that uses readSdgTruth: an import (named, aliased or re-exported) or any reference to it. */
function usesReadSdgTruth(source: string): boolean {
  return /\breadSdgTruth\b/.test(source);
}

/** Files (path + source) that use readSdgTruth. */
function readSdgTruthUsers(files: { path: string; source: string }[]): string[] {
  return files.filter((f) => usesReadSdgTruth(f.source)).map((f) => f.path);
}

describe("answer-key guard: nothing that labels claims or perceives imports readSdgTruth()", () => {
  const GUARDED = ["lib/agent", "lib/pipeline", "lib/api", "lib/truth", "lib/inference", "lib/perception", "app"];

  it("self-test: a planted import is caught, in every form; unrelated names are not", () => {
    const planted = [
      { path: "lib/agent/planted-a.ts", source: `import { readSdgTruth } from "@/lib/capture/sdgWarehouse";` },
      { path: "lib/truth/planted-b.ts", source: `import { readSdgTruth as key } from "../capture/sdgWarehouse";` },
      { path: "app/api/planted-c.ts", source: `const m = await import("@/lib/capture/sdgWarehouse"); m.readSdgTruth(p);` },
      { path: "lib/pipeline/planted-d.ts", source: `export { readSdgTruth } from "@/lib/capture/sdgWarehouse";` },
      { path: "lib/inference/clean.ts", source: `import { importSdgWarehouse } from "@/lib/capture/sdgWarehouse"; // readSdgTruthy` },
    ];
    expect(readSdgTruthUsers(planted)).toEqual(["lib/agent/planted-a.ts", "lib/truth/planted-b.ts", "app/api/planted-c.ts", "lib/pipeline/planted-d.ts"]);
  });

  it("no file under lib/agent, lib/pipeline, lib/api, lib/truth, lib/inference, lib/perception or app/ uses readSdgTruth", async () => {
    const paths = (await Promise.all(GUARDED.map((d) => sourceFiles(d)))).flat();
    expect(paths.length).toBeGreaterThan(50); // the scan really looked at the code
    const files = await Promise.all(paths.map(async (p) => ({ path: p, source: await readFile(path.join(ROOT, p), "utf8") })));
    expect(readSdgTruthUsers(files)).toEqual([]);
  });

  it("readSdgTruth exists where expected (so the scan above is meaningful)", async () => {
    expect(usesReadSdgTruth(await readFile(path.join(ROOT, "lib/capture/sdgWarehouse.ts"), "utf8"))).toBe(true);
    expect(usesReadSdgTruth(await readFile(path.join(ROOT, "scripts/killtests/a.ts"), "utf8"))).toBe(true);
  });
});

