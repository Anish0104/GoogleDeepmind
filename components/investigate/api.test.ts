// OWNER: Dev 4.
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  UPLOAD_URL,
  createInvestigation,
  phoneLink,
  runAgents,
  runPhase,
  sceneBoardHref,
  sceneProofHref,
  startBody,
  startRun,
  submitAccount,
  uploadRecording,
  waitForPerceived,
  type EventSourceLike,
} from "./api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("startBody", () => {
  it("builds the scene/start body, keeping only excluded cameras that are in the scene", () => {
    expect(startBody({ room: " Lab 2 ", cameras: ["A", "C"], excluded: ["C", "D"], questionSet: "" })).toEqual({
      split: "demo",
      room: "Lab 2",
      cameras: ["A", "C"],
      excludedCameras: ["C"],
    });
  });

  it("adds a fixed question set when one is chosen", () => {
    expect(startBody({ room: "Floor", cameras: ["B"], excluded: [], questionSet: "warehouse" }).questionSet).toBe("warehouse");
  });

  it("orders cameras A to D", () => {
    expect(startBody({ room: "x", cameras: ["D", "A"], excluded: [], questionSet: "" }).cameras).toEqual(["A", "D"]);
  });
});

describe("createInvestigation", () => {
  it("returns the new scene id", async () => {
    const f = vi.fn(async () => json(201, { sceneId: "s-123" }));
    await expect(createInvestigation({ room: "r", cameras: ["A"], excluded: [], questionSet: "" }, f)).resolves.toBe("s-123");
    expect(f).toHaveBeenCalledWith("/api/scene/start", expect.objectContaining({ method: "POST" }));
  });

  it("surfaces the server's error message", async () => {
    const f = vi.fn(async () => json(400, { error: "A scene needs at least one camera." }));
    await expect(createInvestigation({ room: "r", cameras: [], excluded: [], questionSet: "" }, f)).rejects.toThrow(
      "A scene needs at least one camera.",
    );
  });
});

describe("uploadRecording", () => {
  it("posts sceneId, camera and file as multipart", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json(200, { ok: true }));
    const file = new File(["abc"], "cam.webm", { type: "video/webm" });
    await uploadRecording("s1", "B", file, f);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(UPLOAD_URL);
    const body = init?.body as FormData;
    expect(body.get("sceneId")).toBe("s1");
    expect(body.get("camera")).toBe("B");
    expect((body.get("file") as File).name).toBe("cam.webm");
  });

  it("throws ApiError with the status on failure", async () => {
    const f = vi.fn(async () => json(400, { ok: false, error: "expected chunk" }));
    const err = await uploadRecording("s1", "A", new File(["x"], "a.webm"), f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toBe("expected chunk");
  });
});

describe("startRun, submitAccount, runAgents", () => {
  it("accepts the 202 from run", async () => {
    const f = vi.fn(async () => json(202, { sceneId: "s1", status: "queued" }));
    await expect(startRun("s1", f)).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledWith("/api/scene/s1/run", expect.objectContaining({ method: "POST" }));
  });

  it("explains a 409 from run", async () => {
    const f = vi.fn(async () => json(409, { error: "Scene s1 already has a run in progress." }));
    await expect(startRun("s1", f)).rejects.toThrow("already has a run in progress");
  });

  it("posts the transcript and returns claim results", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json(200, [{ claimId: "c1", verdict: "Supported" }]));
    const out = await submitAccount("s1", "I put the cup down.", f);
    expect(out).toHaveLength(1);
    expect(JSON.parse(f.mock.calls[0]![1]?.body as string)).toEqual({ transcript: "I put the cup down." });
  });

  it("rejects an empty statement before calling the server", async () => {
    const f = vi.fn();
    await expect(submitAccount("s1", "   ", f)).rejects.toThrow("statement");
    expect(f).not.toHaveBeenCalled();
  });

  it("returns per-claim agent outcomes", async () => {
    const f = vi.fn(async () => json(200, { sceneId: "s1", claims: [{ claimId: "c1", ran: true }] }));
    await expect(runAgents("s1", f)).resolves.toEqual([{ claimId: "c1", ran: true }]);
  });

  it("uses a generic message when the error body is not JSON", async () => {
    const f = vi.fn(async () => new Response("boom", { status: 500 }));
    await expect(runAgents("s1", f)).rejects.toThrow("Request failed (500)");
  });
});

describe("runPhase", () => {
  it("describes each run stage", () => {
    expect(runPhase(null)).toEqual({ label: "Waiting for the run to start", done: false, failed: false });
    expect(runPhase({ status: "running", stage: "perceive", startedAt: "" }).label).toBe("Reading the footage");
    expect(runPhase({ status: "running", stage: "probe", startedAt: "" }).label).toBe("Checking the recordings");
    expect(runPhase({ status: "perceived", stage: "perceived", startedAt: "" }).done).toBe(true);
    expect(runPhase({ status: "done", stage: "x", startedAt: "" }).done).toBe(true);
  });

  it("reports failures with the reason", () => {
    const p = runPhase({ status: "failed", stage: "perceive", startedAt: "", error: "budget" });
    expect(p.failed).toBe(true);
    expect(p.label).toContain("budget");
  });
});

class FakeSource implements EventSourceLike {
  listeners = new Map<string, (e: MessageEvent) => void>();
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe("waitForPerceived", () => {
  it("resolves once run.json says perceived, reporting each change", async () => {
    const src = new FakeSource();
    const seen: string[] = [];
    const p = waitForPerceived("s1", { open: () => src, onRun: (r) => seen.push(r.stage) });
    src.emit("run", { status: "running", stage: "probe", startedAt: "" });
    src.emit("run", { status: "perceived", stage: "perceived", startedAt: "" });
    await expect(p).resolves.toMatchObject({ status: "perceived" });
    expect(seen).toEqual(["probe", "perceived"]);
    expect(src.closed).toBe(true);
  });

  it("opens the scene's event stream", () => {
    const open = vi.fn(() => new FakeSource());
    void waitForPerceived("s 1", { open }).catch(() => {});
    expect(open).toHaveBeenCalledWith("/api/scene/s%201/events");
  });

  it("rejects when the run fails", async () => {
    const src = new FakeSource();
    const p = waitForPerceived("s1", { open: () => src });
    src.emit("run", { status: "failed", stage: "perceive", startedAt: "", error: "no video" });
    await expect(p).rejects.toThrow("no video");
    expect(src.closed).toBe(true);
  });

  it("ignores malformed frames", async () => {
    const src = new FakeSource();
    const p = waitForPerceived("s1", { open: () => src });
    src.listeners.get("run")?.({ data: "not json" } as MessageEvent);
    src.emit("run", { status: "perceived", stage: "perceived", startedAt: "" });
    await expect(p).resolves.toMatchObject({ status: "perceived" });
  });
});

describe("links", () => {
  it("points the board and proof at the new scene folder", () => {
    expect(sceneBoardHref("s1")).toBe("/board?scene=data%2Fscenes%2Fs1");
    expect(sceneProofHref("s1", "c 2")).toBe("/proof/c%202?scene=data%2Fscenes%2Fs1");
  });

  it("builds the phone capture link for a camera", () => {
    expect(phoneLink("https://host:3000", "s1", "C")).toBe("https://host:3000/phone?scene=s1&cam=C");
  });
});
