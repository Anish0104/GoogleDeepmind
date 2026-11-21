// OWNER: Dev 1. SHIP FIRST: Dev 2's auditor and Dev 3's bridge call this.
// Cuts a 1-4 s clip from the local recording and asks Decision 1 about it.
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { CameraId, Claim, Evidence } from "@/lib/types";
import { LIMITS } from "@/lib/config";
import { recordingPath } from "@/lib/capture/files";
import { localTime } from "@/lib/capture/sync";
import { scenePath } from "@/lib/store/scene";
import { decide, mediaPart, textPart, type DecisionQuestion, type Part } from "@/lib/gemini/client";
import { clip } from "@/lib/video/ffmpeg";

export interface CheckWindowArgs {
  sceneId: string;
  camera: CameraId;
  window: [number, number];
  /** "entity" currently falls back to the full frame (no entity boxes yet). */
  crop: "full" | "entity";
  claim: Claim;
  source: Evidence["source"];
}

/** Local path of a clip produced by checkWindow(). */
export function clipPath(sceneId: string, clipId: string): string {
  return scenePath(sceneId, `clips/${clipId}.mp4`);
}

/** The clip as a model input part, for callers holding only a clipId (e.g. Dev 2's auditor). */
export function clipParts(sceneId: string, clipId: string): Part[] {
  if (!/^[A-D]_\d+\.\d{2}-\d+\.\d{2}_full$/.test(clipId)) throw new Error(`not a checkWindow clip id: ${clipId}`);
  const file = clipPath(sceneId, clipId);
  if (!existsSync(file)) throw new Error(`clip ${clipId} not found for scene ${sceneId}`);
  return [mediaPart(readFileSync(file).toString("base64"), "video/mp4")];
}

function recording(sceneId: string, camera: CameraId): string {
  const file = recordingPath(sceneId, camera);
  if (!file) throw new Error(`no recording for scene ${sceneId}: cam-${camera}.webm not found`);
  return file;
}

const EPS = 1e-6;
const ArgsSchema = z.object({
  sceneId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
  camera: z.enum(["A", "B", "C", "D"]),
  window: z
    .tuple([z.number().min(0), z.number()])
    .refine(([s, e]) => e - s >= LIMITS.CLIP_MIN_S - EPS && e - s <= LIMITS.CLIP_MAX_S + EPS, {
      message: `window must be ${LIMITS.CLIP_MIN_S}-${LIMITS.CLIP_MAX_S} s long`,
    }),
  crop: z.enum(["full", "entity"]),
  source: z.enum(["initial", "investigator", "skeptic"]),
});

const Prob = z.number().min(0).max(1);
const AnswerSchema = z.object({ visible: Prob, supports: Prob, contradicts: Prob });

function questions(claim: Claim): DecisionQuestion[] {
  return [
    {
      id: "visible",
      kind: "noul",
      text:
        `Is the ${claim.object} clearly visible in this clip for most of its length, ` +
        `unblocked and in frame, so that what happens to it could be judged?`,
    },
    {
      id: "supports",
      kind: "noul",
      text:
        `Does this clip show the following actually happening: "${claim.text}" ` +
        `(${claim.actor}, ${claim.object}, ${claim.action})? Answer true only if it is visibly shown.`,
    },
    {
      id: "contradicts",
      kind: "noul",
      text:
        `Does this clip clearly show something that makes the following false: "${claim.text}"? ` +
        `Answer false if the action is simply not visible, blocked or out of frame; ` +
        `answer true only if the clip visibly shows something different happening.`,
    },
  ];
}

export async function checkWindow(args: CheckWindowArgs): Promise<Evidence> {
  ArgsSchema.parse(args);
  const { sceneId, camera, claim, source } = args;
  const [start, end] = args.window;

  const input = recording(sceneId, camera);
  const clipId = `${camera}_${start.toFixed(2)}-${end.toFixed(2)}_full`;
  const out = clipPath(sceneId, clipId);
  if (!existsSync(out)) {
    const localStart = await localTime(sceneId, camera, start);
    if (localStart < 0) throw new Error(`window starts before camera ${camera} was recording`);
    await clip(input, localStart, localStart + (end - start), out);
  }

  const raw = await decide(
    [mediaPart(readFileSync(out).toString("base64"), "video/mp4"), textPart(`Claim under review: "${claim.text}"`)],
    questions(claim),
    { purpose: `checkWindow:${source}`, sceneId },
  );
  const a = AnswerSchema.parse(raw);

  return {
    camera,
    window: [start, end],
    visible: a.visible,
    supports: a.supports,
    contradicts: a.contradicts,
    clipId,
    source,
  };
}
