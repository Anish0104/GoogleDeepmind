// OWNER: Dev 3. Server-Sent Events for the board, built only from the scene's files (run.json, results.json,
// agent-steps.jsonl), so it works across processes and for replay scenes.
// On connect: the full current state (run, every result, every step line). Then, polling every pollMs, only
// changes: "run" when run.json changes, "result" when a claim's label changes (or a new claim appears),
// "step" for each new complete line of agent-steps.jsonl (carrying mode and implicitStop as written), and
// "reset" { reason: "steps-rewritten" } when that file gets shorter than what was sent, before resending it.
// A heartbeat comment every heartbeatMs keeps proxies from closing the connection. Stops on client abort.
import { readFile } from "node:fs/promises";
import { loadResults, NotFoundError, readJson, scenePath } from "@/lib/store/scene";
import type { ClaimResult, RunStatus } from "@/lib/types";
import { AGENT_STEPS_FILE } from "@/lib/agent/log";
import { RUN_FILE } from "@/lib/pipeline/run";

export interface SceneReaders {
  /** run.json, or null if the scene has not been run. */
  readRun: (sceneId: string) => Promise<RunStatus | null>;
  readResults: (sceneId: string) => Promise<ClaimResult[]>;
  /** Raw agent-steps.jsonl text, or "" if it doesn't exist. */
  readSteps: (sceneId: string) => Promise<string>;
}

export const fileReaders: SceneReaders = {
  readRun: async (sceneId) => {
    try {
      return await readJson<RunStatus>(sceneId, RUN_FILE);
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  },
  readResults: loadResults,
  readSteps: async (sceneId) => {
    try {
      return await readFile(scenePath(sceneId, AGENT_STEPS_FILE), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw e;
    }
  },
};

export interface SceneStreamOptions {
  signal: AbortSignal;
  readers?: SceneReaders;
  pollMs?: number;
  heartbeatMs?: number;
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** An SSE byte stream for one scene. The caller returns it as a text/event-stream response. */
export function sceneEventStream(sceneId: string, opts: SceneStreamOptions): ReadableStream<Uint8Array> {
  const { signal, readers = fileReaders, pollMs = 500, heartbeatMs = 15_000 } = opts;
  const enc = new TextEncoder();
  let closed = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let beatTimer: ReturnType<typeof setInterval> | undefined;
  let close = () => {};

  // What the client already has.
  let lastRun: string | null = null;
  const labels = new Map<string, string>();
  let linesSent = 0;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        if (!closed) controller.enqueue(enc.encode(text));
      };
      close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(pollTimer);
        clearInterval(beatTimer);
        signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // already closed by a cancel
        }
      };

      // Each file is read on its own: a file caught mid-write only skips that file for this poll.
      const poll = async () => {
        try {
          const run = await readers.readRun(sceneId);
          const json = run && JSON.stringify(run);
          if (json && json !== lastRun) {
            lastRun = json;
            send(frame("run", run));
          }
        } catch {
          /* retry next poll */
        }
        try {
          for (const r of await readers.readResults(sceneId)) {
            if (labels.get(r.claimId) !== r.verdict) {
              labels.set(r.claimId, r.verdict);
              send(frame("result", r));
            }
          }
        } catch {
          /* retry next poll */
        }
        try {
          const complete = (await readers.readSteps(sceneId)).split("\n").slice(0, -1); // last piece may be partial
          if (complete.length < linesSent) {
            // The file was replaced (e.g. a replay copied over): tell the board to drop its steps, then resend.
            send(frame("reset", { reason: "steps-rewritten" }));
            linesSent = 0;
          }
          for (const line of complete.slice(linesSent)) {
            if (!line.trim()) continue;
            try {
              send(frame("step", JSON.parse(line)));
            } catch {
              /* a malformed line is skipped, not resent */
            }
          }
          linesSent = complete.length;
        } catch {
          /* retry next poll */
        }
      };

      const tick = async () => {
        await poll();
        if (!closed) pollTimer = setTimeout(() => void tick(), pollMs);
      };

      if (signal.aborted) return close();
      signal.addEventListener("abort", close);
      beatTimer = setInterval(() => send(": heartbeat\n\n"), heartbeatMs);
      void tick(); // the first poll sends the full current state
    },
    cancel() {
      close();
    },
  });
}
