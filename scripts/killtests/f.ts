// OWNER: Dev 1. Kill test F: is sync accurate? Phones film a stopwatch on a laptop screen (with the
// usual clap + flash); after sync, the stopwatch read from every camera at the same synced moment must
// agree. Pass: every camera within 1 frame (plus the stopwatch's display step) of the median reading,
// at >= MIN_MOMENTS moments where at least two cameras can read it.
// Reads the stopwatch with one Hydrogen call per camera per moment (default 6 moments: ~24 calls).
// Uses sync.json if present, otherwise runs syncScene() first.
// Usage: pnpm killtest f --scene <id> [--times 6]
import { mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { CameraId } from "@/lib/types";

export const KILL_TEST_F = {
  /** One frame at 30 fps. */
  FRAME_S: 1 / 30,
  /** A stopwatch showing hundredths can be read 0.01 s apart within one frame. */
  DISPLAY_STEP_S: 0.01,
  TIMES: 6,
  MIN_MOMENTS: 3,
  /** Stills sent to the model: enough to read the digits, still low-res. */
  STILL_WIDTH: 768,
  /** Keep moments this far from the shared footage's ends. */
  EDGE_S: 0.5,
} as const;

export const sampleTimes = (start: number, end: number, n: number): number[] =>
  n <= 1 ? [start] : Array.from({ length: n }, (_, i) => Math.round((start + ((end - start) * i) / (n - 1)) * 1000) / 1000);

export interface Moment {
  /** Synced time (s). */
  t: number;
  /** Stopwatch reading (s) per camera; null when it could not be read. */
  readings: Partial<Record<CameraId, number | null>>;
}

export interface MomentErrors extends Moment {
  median: number | null;
  /** Reading minus median, per camera that could read it. */
  errors: Partial<Record<CameraId, number>>;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function syncErrors(moments: Moment[]): MomentErrors[] {
  return moments.map((m) => {
    const read = Object.entries(m.readings).filter((e): e is [CameraId, number] => typeof e[1] === "number");
    if (read.length < 2) return { ...m, median: null, errors: {} };
    const med = median(read.map(([, v]) => v));
    return { ...m, median: med, errors: Object.fromEntries(read.map(([c, v]) => [c, v - med])) };
  });
}

export function judgeSync(moments: MomentErrors[]): { pass: boolean; readable: number; maxErrorS: number; failures: string[] } {
  const tol = KILL_TEST_F.FRAME_S + KILL_TEST_F.DISPLAY_STEP_S;
  const readable = moments.filter((m) => m.median !== null);
  const failures: string[] = [];
  let maxErrorS = 0;
  for (const m of readable) {
    for (const [cam, e] of Object.entries(m.errors)) {
      maxErrorS = Math.max(maxErrorS, Math.abs(e!));
      if (Math.abs(e!) > tol) {
        failures.push(`camera ${cam} off by ${(e! * 1000).toFixed(0)} ms at t=${m.t} s (allowed ${(tol * 1000).toFixed(0)} ms)`);
      }
    }
  }
  if (readable.length < KILL_TEST_F.MIN_MOMENTS) {
    failures.push(`stopwatch readable on 2+ cameras at only ${readable.length} moments (need ${KILL_TEST_F.MIN_MOMENTS})`);
  }
  return { pass: failures.length === 0, readable: readable.length, maxErrorS, failures };
}

const ReadingSchema = z.object({ seconds: z.number().nonnegative().nullable() });

/** Reads a stopwatch on a screen in a still: total seconds, or null if it can't be read. One model call. */
export async function readStopwatch(stillPath: string, sceneId: string): Promise<number | null> {
  const { readFileSync } = await import("node:fs");
  const { generateJson, mediaPart, textPart } = await import("@/lib/gemini/client");
  const { MODELS } = await import("@/lib/config");
  const out = await generateJson(
    MODELS.SCOUT,
    [
      textPart(
        "This still shows a stopwatch or timer on a screen. Read the time it displays exactly, including " +
          "hundredths of a second (e.g. 01:23.45 is 83.45 seconds). Reply with the total in seconds. " +
          "If no timer is visible or the digits are not readable, reply null.",
      ),
      mediaPart(readFileSync(stillPath).toString("base64"), "image/jpeg"),
    ],
    ReadingSchema,
    { purpose: "killtest-f", sceneId },
  );
  return out.seconds;
}

export type Reader = (stillPath: string) => Promise<number | null>;

export interface KillTestFRun {
  sceneId: string;
  moments: MomentErrors[];
  pass: boolean;
  readable: number;
  maxErrorS: number;
  failures: string[];
}

export async function runKillTestF(o: { sceneId: string; reader?: Reader; times?: number }): Promise<KillTestFRun> {
  const { existsSync } = await import("node:fs");
  const { loadManifest, scenePath } = await import("@/lib/store/scene");
  const { recordingPath } = await import("@/lib/capture/files");
  const { localTime, syncScene } = await import("@/lib/capture/sync");
  const { probe, still } = await import("@/lib/video/ffmpeg");

  const manifest = await loadManifest(o.sceneId);
  if (!existsSync(scenePath(o.sceneId, "sync.json"))) await syncScene(manifest);
  const cams = manifest.cameras.filter((c) => !manifest.excludedCameras.includes(c));
  const files = Object.fromEntries(
    cams.map((c) => {
      const f = recordingPath(o.sceneId, c, manifest.files);
      if (!f) throw new Error(`scene ${o.sceneId}: no recording for camera ${c}`);
      return [c, f];
    }),
  ) as Record<CameraId, string>;

  // Shared synced range: camera c covers [-offset, duration - offset] (local = synced + offset at t ~ 0).
  let lo = 0;
  let hi = Infinity;
  for (const c of cams) {
    const zero = await localTime(o.sceneId, c, 0);
    const { durationS } = await probe(files[c]);
    lo = Math.max(lo, -zero);
    hi = Math.min(hi, durationS - zero);
  }
  if (!(hi - lo > 2 * KILL_TEST_F.EDGE_S)) throw new Error(`scene ${o.sceneId}: cameras share too little footage to test sync`);
  const times = sampleTimes(lo + KILL_TEST_F.EDGE_S, hi - KILL_TEST_F.EDGE_S, o.times ?? KILL_TEST_F.TIMES);

  const dir = scenePath(o.sceneId, "killtest-f");
  mkdirSync(dir, { recursive: true });
  const reader: Reader = o.reader ?? ((p) => readStopwatch(p, o.sceneId));
  const moments: Moment[] = [];
  for (const t of times) {
    const readings: Moment["readings"] = {};
    await Promise.all(
      cams.map(async (c) => {
        const local = await localTime(o.sceneId, c, t);
        const out = path.join(dir, `cam-${c}-${t.toFixed(3)}.jpg`);
        await still(files[c], local, out, KILL_TEST_F.STILL_WIDTH);
        readings[c] = await reader(out);
      }),
    );
    moments.push({ t, readings });
  }
  const errs = syncErrors(moments);
  return { sceneId: o.sceneId, moments: errs, ...judgeSync(errs) };
}

export async function main(): Promise<void> {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const sceneId = arg("--scene");
  if (!sceneId) throw new Error("usage: pnpm killtest f --scene <id> [--times 6]");
  const r = await runKillTestF({ sceneId, times: Number(arg("--times") ?? KILL_TEST_F.TIMES) });
  console.log(
    `Kill test F: ${r.pass ? "PASS" : "FAIL"}  scene ${sceneId}: max error ${(r.maxErrorS * 1000).toFixed(0)} ms ` +
      `(1 frame = ${(KILL_TEST_F.FRAME_S * 1000).toFixed(0)} ms) over ${r.readable} readable moments`,
  );
  for (const m of r.moments) {
    const cells = Object.entries(m.readings).map(([c, v]) => `${c}=${v === null || v === undefined ? "?" : v.toFixed(2)}`);
    console.log(`  t=${m.t.toFixed(2)}  ${cells.join("  ")}`);
  }
  for (const f of r.failures) console.log(`  - ${f}`);
  if (!r.pass) process.exitCode = 1;
}
