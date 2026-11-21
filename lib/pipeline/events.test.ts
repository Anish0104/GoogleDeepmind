// OWNER: Dev 3. The board's event stream over fake scene files (no disk, no models).
import { describe, expect, it, vi } from "vitest";
import type { AgentStep, ClaimResult, RunStatus, Verdict } from "@/lib/types";
import { sceneEventStream, type SceneReaders } from "@/lib/pipeline/events";

const result = (claimId: string, verdict: Verdict): ClaimResult => ({ claimId, verdict, evidence: [], audit: null, history: [] });
const step = (n: number, o: Partial<AgentStep> = {}): AgentStep => ({
  agent: "investigator",
  claimId: "c1",
  n,
  action: "stop",
  args: { reason: `step ${n}` },
  tokens: 0,
  costUsd: 0,
  latencyMs: 0,
  ...o,
});

/** Mutable fake files; readers count their calls so we can check polling stops on abort. */
function fakeScene() {
  const state = {
    run: { status: "running", stage: "lattice", startedAt: "t0" } as RunStatus | null,
    results: [result("c1", "Insufficient"), result("c2", "Supported")],
    steps: JSON.stringify(step(1, { mode: "managed" })) + "\n",
  };
  let reads = 0;
  const readers: SceneReaders = {
    readRun: async () => (reads++, state.run && structuredClone(state.run)),
    readResults: async () => structuredClone(state.results),
    readSteps: async () => state.steps,
  };
  return { state, readers, reads: () => reads };
}

interface Ev {
  event?: string;
  data?: unknown;
  comment?: string;
}

/** Reads SSE frames from the stream as they arrive. */
function frames(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const queue: Ev[] = [];
  let closed = false;
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (block.startsWith(":")) queue.push({ comment: block.slice(1).trim() });
        else {
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          queue.push({ event: ev, data: data === undefined ? undefined : JSON.parse(data) });
        }
      }
    }
    closed = true;
  })();
  return {
    queue,
    isClosed: () => closed,
    pump,
    /** Waits until `n` non-comment events have arrived, returns them, and removes them. */
    async take(n: number): Promise<Ev[]> {
      await vi.waitFor(() => expect(queue.filter((e) => !e.comment).length).toBeGreaterThanOrEqual(n), { timeout: 2000, interval: 5 });
      const out: Ev[] = [];
      while (out.length < n) {
        const e = queue.shift()!;
        if (!e.comment) out.push(e);
      }
      return out;
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("sceneEventStream", () => {
  it("sends the full state on connect: run, every result, every step line", async () => {
    const { readers } = fakeScene();
    const ac = new AbortController();
    const f = frames(sceneEventStream("s1", { signal: ac.signal, readers, pollMs: 5, heartbeatMs: 10_000 }));

    expect(await f.take(4)).toEqual([
      { event: "run", data: { status: "running", stage: "lattice", startedAt: "t0" } },
      { event: "result", data: result("c1", "Insufficient") },
      { event: "result", data: result("c2", "Supported") },
      { event: "step", data: step(1, { mode: "managed" }) },
    ]);
    ac.abort();
  });

  it("then sends only changes: run stage, a label change, and each new step line (with mode and implicitStop)", async () => {
    const { state, readers } = fakeScene();
    const ac = new AbortController();
    const f = frames(sceneEventStream("s1", { signal: ac.signal, readers, pollMs: 5, heartbeatMs: 10_000 }));
    await f.take(4);

    await sleep(30); // several polls with nothing changed
    expect(f.queue.filter((e) => !e.comment)).toEqual([]);

    // Evidence changes but the label doesn't: no event.
    state.results[1] = {
      ...result("c2", "Supported"),
      evidence: [{ camera: "B", window: [10, 13], visible: 0.9, supports: 0.9, contradicts: 0.01, clipId: "clip-B", source: "investigator" }],
    };
    await sleep(20);
    expect(f.queue.filter((e) => !e.comment)).toEqual([]);

    state.run = { status: "running", stage: "agents", startedAt: "t0" };
    state.results[0] = result("c1", "Supported");
    state.steps +=
      JSON.stringify(step(2, { mode: "managed", implicitStop: true })) +
      "\n" +
      JSON.stringify(step(3, { mode: "standin-fallback" })) +
      "\n" +
      '{"agent":"investigator","n":4'; // half-written line: not sent until complete

    const got = await f.take(4);
    expect(got).toEqual([
      { event: "run", data: { status: "running", stage: "agents", startedAt: "t0" } },
      { event: "result", data: result("c1", "Supported") },
      { event: "step", data: step(2, { mode: "managed", implicitStop: true }) },
      { event: "step", data: step(3, { mode: "standin-fallback" }) },
    ]);

    state.steps = state.steps.replace(/\{"agent":"investigator","n":4$/, JSON.stringify(step(4)) + "\n");
    expect(await f.take(1)).toEqual([{ event: "step", data: step(4) }]);
    ac.abort();
  });

  it("a new claim's first result is sent", async () => {
    const { state, readers } = fakeScene();
    const ac = new AbortController();
    const f = frames(sceneEventStream("s1", { signal: ac.signal, readers, pollMs: 5, heartbeatMs: 10_000 }));
    await f.take(4);
    state.results.push(result("c3", "Contradicted"));
    expect(await f.take(1)).toEqual([{ event: "result", data: result("c3", "Contradicted") }]);
    ac.abort();
  });

  it("sends heartbeat comments", async () => {
    const { readers } = fakeScene();
    const ac = new AbortController();
    const f = frames(sceneEventStream("s1", { signal: ac.signal, readers, pollMs: 5, heartbeatMs: 15 }));
    await vi.waitFor(() => expect(f.queue.some((e) => e.comment === "heartbeat")).toBe(true), { timeout: 2000 });
    ac.abort();
  });

  it("works before any file exists (no run.json, no results, no steps) and picks them up later", async () => {
    const { state, readers } = fakeScene();
    state.run = null;
    state.results = [];
    state.steps = "";
    const ac = new AbortController();
    const f = frames(sceneEventStream("s1", { signal: ac.signal, readers, pollMs: 5, heartbeatMs: 10_000 }));
    await sleep(20);
    expect(f.queue.filter((e) => !e.comment)).toEqual([]);
    state.run = { status: "queued", stage: "queued", startedAt: "t0" };
    expect(await f.take(1)).toEqual([{ event: "run", data: state.run }]);
    ac.abort();
  });

  it("stops polling and closes the stream on client abort", async () => {
    const fake = fakeScene();
    const ac = new AbortController();
    const f = frames(sceneEventStream("s1", { signal: ac.signal, readers: fake.readers, pollMs: 5, heartbeatMs: 10 }));
    await f.take(4);

    ac.abort();
    await f.pump;
    expect(f.isClosed()).toBe(true);
    const readsAtAbort = fake.reads();
    await sleep(40);
    expect(fake.reads()).toBe(readsAtAbort);
  });

  it("a reader error (file mid-write) skips that poll instead of ending the stream", async () => {
    const { state, readers } = fakeScene();
    let fail = false;
    const flaky: SceneReaders = {
      ...readers,
      readResults: async () => {
        if (fail) throw new SyntaxError("Unexpected end of JSON input");
        return readers.readResults("s1");
      },
    };
    const ac = new AbortController();
    const f = frames(sceneEventStream("s1", { signal: ac.signal, readers: flaky, pollMs: 5, heartbeatMs: 10_000 }));
    await f.take(4);
    fail = true;
    await sleep(20);
    fail = false;
    state.results[0] = result("c1", "Contradicted");
    expect(await f.take(1)).toEqual([{ event: "result", data: result("c1", "Contradicted") }]);
    expect(f.isClosed()).toBe(false);
    ac.abort();
  });
});
