// OWNER: Dev 3. The account (Dev 2's real runAccount) and the agents route share one scene lock: they never run
// at the same time. Only the model call (splitClaims) and the budget check are replaced; everything else is real,
// on a temp DATA_DIR.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Claim } from "@/lib/types";

const splitClaims = vi.fn<(transcript: string, sceneId: string) => Promise<Claim[]>>();
const splitClaimsDetailed = vi.fn(async (transcript: string, sceneId: string) => ({
  claims: await splitClaims(transcript, sceneId),
  rejected: [],
}));
vi.mock("@/lib/truth/claims", async (orig) => ({ ...(await orig<typeof import("@/lib/truth/claims")>()), splitClaims, splitClaimsDetailed }));
vi.mock("@/lib/cost", async (orig) => ({ ...(await orig<typeof import("@/lib/cost")>()), assertBudget: async () => {} }));

const SCENE = "lock1";
const claim: Claim = { id: "c1", sceneId: SCENE, text: "Sam put the mug in zone C", actor: "Sam", object: "mug", action: "put", window: [1, 3], timeIsPrecise: true };
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

let dataDir: string;
const prev = process.env.DATA_DIR;
let runAccount: typeof import("@/lib/truth/account").runAccount;
let handlers: typeof import("@/lib/api/handlers");
let store: typeof import("@/lib/store/scene");

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-lock-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  store = await import("@/lib/store/scene");
  ({ runAccount } = await import("@/lib/truth/account"));
  handlers = await import("@/lib/api/handlers");
  await store.createScene({ split: "dev", room: "r", cameras: ["A", "B"], excludedCameras: [] }, { id: SCENE });
});

afterAll(async () => {
  if (prev === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prev;
  await rm(dataDir, { recursive: true, force: true });
});

const fakeAgent = (gate?: Promise<void>) =>
  vi.fn(async (_agent: string, c: Claim) => {
    if (gate) await gate;
    return {
      ran: true as const,
      run: { result: { claimId: c.id, verdict: "Insufficient" as const, evidence: [], audit: null, history: [] }, steps: [], stopReason: "agent" as const, mode: "standin" as const },
    };
  });

describe("account and agents can't run concurrently", () => {
  it("while runAccount() is running, the agents route (and the run route's lock) gets 409; afterwards it runs", async () => {
    const extraction = deferred<Claim[]>();
    splitClaims.mockImplementationOnce(() => extraction.promise);

    const account = runAccount(SCENE, "Sam put the mug in zone C.");
    await vi.waitFor(() => expect(splitClaims).toHaveBeenCalledTimes(1)); // the account is mid-run, holding the scene

    expect(store.isSceneLocked(SCENE)).toBe(true);
    const startAgent = fakeAgent();
    const blocked = await handlers.handleAgentsRun(SCENE, { ...handlers.defaultAgentsRunDeps, startAgent });
    expect(blocked).toEqual({ status: 409, body: { error: `Scene ${SCENE} already has a run in progress.` } });
    expect(store.lockScene(SCENE)).toBeNull(); // what the run route and /investigate use too
    expect(startAgent).not.toHaveBeenCalled();

    extraction.resolve([claim]);
    expect((await account).map((r) => r.claimId)).toEqual(["c1"]);
    expect(store.isSceneLocked(SCENE)).toBe(false);

    const after = await handlers.handleAgentsRun(SCENE, { ...handlers.defaultAgentsRunDeps, startAgent });
    expect(after.status).toBe(200);
    expect(startAgent).toHaveBeenCalledTimes(1);
  });

  it("while the agents route is running, runAccount() waits its turn and only then calls the model", async () => {
    const gate = deferred<void>();
    const startAgent = fakeAgent(gate.promise);
    const agents = handlers.handleAgentsRun(SCENE, { ...handlers.defaultAgentsRunDeps, startAgent });
    await vi.waitFor(() => expect(startAgent).toHaveBeenCalledTimes(1)); // agents are mid-run, holding the scene

    splitClaims.mockClear();
    splitClaims.mockResolvedValueOnce([claim]);
    const account = runAccount(SCENE, "Sam put the mug in zone C.");
    await new Promise((r) => setTimeout(r, 30));
    expect(splitClaims).not.toHaveBeenCalled(); // queued behind the agents

    gate.resolve();
    expect((await agents).status).toBe(200);
    await account;
    expect(splitClaims).toHaveBeenCalledTimes(1);
    expect(store.isSceneLocked(SCENE)).toBe(false);
  });
});
