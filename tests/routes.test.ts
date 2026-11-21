// OWNER: Dev 3. The route files are thin wrappers: check they pass the right agent and body through,
// and that the events route rejects bad ids and serves text/event-stream. Handlers are mocked.
import { describe, expect, it, vi } from "vitest";

const handleAgentRequest = vi.fn(async (_agent: string, _body: unknown) => ({ status: 409, body: { error: "locked" } }));
const handleSceneStart = vi.fn(async (_body: unknown) => ({ status: 201, body: { sceneId: "s-new" } }));
const handleRunStart = vi.fn(async (_id: string) => ({ status: 202, body: { sceneId: "s1", status: "queued" } }));
const handleAgentsRun = vi.fn(async (_id: string) => ({ status: 409, body: { error: "locked" } }));
vi.mock("@/lib/api/handlers", () => ({ handleAgentRequest, handleSceneStart, handleRunStart, handleAgentsRun }));

const post = (body: string) => new Request("http://x/api", { method: "POST", body, headers: { "content-type": "application/json" } });

describe("agent routes", () => {
  it.each([
    ["@/app/api/investigate/route", "investigator"],
    ["@/app/api/skeptic/route", "skeptic"],
  ])("%s passes %s and the body through, keeping the status", async (mod, agent) => {
    handleAgentRequest.mockClear();
    const { POST } = (await import(mod)) as { POST: (r: Request) => Promise<Response> };
    const res = await POST(post(JSON.stringify({ sceneId: "s1", claimId: "c1" })));
    expect(handleAgentRequest).toHaveBeenCalledWith(agent, { sceneId: "s1", claimId: "c1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "locked" });
  });

  it("an unparseable body reaches the handler as null (it answers 400)", async () => {
    handleAgentRequest.mockClear();
    const { POST } = await import("@/app/api/investigate/route");
    await POST(post("{not json"));
    expect(handleAgentRequest).toHaveBeenCalledWith("investigator", null);
  });
});

describe("POST /api/scene/start", () => {
  it("returns the handler's 201 { sceneId }", async () => {
    const { POST } = await import("@/app/api/scene/start/route");
    const res = await POST(post(JSON.stringify({ split: "demo", room: "r", cameras: ["A"], excludedCameras: [] })));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ sceneId: "s-new" });
  });
});

describe("GET /api/scene/[id]/events", () => {
  const get = async (id: string, signal?: AbortSignal) => {
    const { GET } = await import("@/app/api/scene/[id]/events/route");
    return GET(new Request(`http://x/api/scene/${id}/events`, { signal }), { params: Promise.resolve({ id }) });
  };

  it("400 for an unsafe scene id", async () => {
    expect((await get("..")).status).toBe(400);
  });

  it("serves text/event-stream and ends when the client aborts", async () => {
    const ac = new AbortController();
    const res = await get("route-test-no-such-scene", ac.signal);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(res.headers.get("cache-control")).toMatch(/no-cache/);
    const reader = res.body!.getReader();
    ac.abort();
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });
});

describe("POST /api/scene/[id]/run and /agents", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  it("run passes the scene id through and returns the handler's 202", async () => {
    const { POST } = await import("@/app/api/scene/[id]/run/route");
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("s1"));
    expect(handleRunStart).toHaveBeenCalledWith("s1");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ sceneId: "s1", status: "queued" });
  });

  it("agents passes the scene id through and keeps the handler's status", async () => {
    const { POST } = await import("@/app/api/scene/[id]/agents/route");
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("s1"));
    expect(handleAgentsRun).toHaveBeenCalledWith("s1");
    expect(res.status).toBe(409);
  });
});
