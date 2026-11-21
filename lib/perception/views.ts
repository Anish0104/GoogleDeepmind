// OWNER: Dev 1. Hydrogen: one sentence per camera describing its angle and what's blocked.
// One model call per scene with each camera's middle still (the same low-res stills scout sees).
// Written to views.json as [{ camera, text }] for Dev 3's agent menu. Descriptions are about the
// viewpoint and fixed obstructions only, so they stay true for the whole recording; nothing about
// where people or objects happen to be in that frame, and no one is identified.
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { CameraId, ViewDescription } from "@/lib/types";
import { MODELS } from "@/lib/config";
import { generateJson, mediaPart, textPart, type Part } from "@/lib/gemini/client";
import { writeJson } from "@/lib/store/scene";

const CAMERAS: CameraId[] = ["A", "B", "C", "D"];

const PROMPT = `Each still below comes from a different fixed camera filming the same scene at the same moment.
For each camera, write ONE short sentence (at most 25 words) that would help someone choose which camera to check:
- its height and angle (e.g. "ceiling-high, looking steeply down", "eye level, side-on");
- roughly how far it is from the main action and which part of the scene fills the frame;
- what tends to be blocked or hidden from it (e.g. "the forklift's body hides anything directly behind it").
Describe the camera, not the moment: do not say where people or objects are in this frame or what is happening.
Do not identify anyone. Use the camera letters exactly as labelled.`;

const ReplySchema = z.object({
  views: z.array(z.object({ camera: z.enum(["A", "B", "C", "D"]), text: z.string().trim().min(5).max(240) })),
});

const mimeFor = (file: string) => (/\.png$/i.test(file) ? "image/png" : "image/jpeg");

export async function describeViews(
  stillsByCamera: Partial<Record<CameraId, string>>,
  sceneId: string,
): Promise<ViewDescription[]> {
  const cams = CAMERAS.filter((c) => stillsByCamera[c] !== undefined);
  if (cams.length === 0) throw new Error("describeViews needs at least one still");
  for (const c of cams) if (!existsSync(stillsByCamera[c]!)) throw new Error(`camera ${c}: still ${stillsByCamera[c]} not found`);

  const parts: Part[] = [textPart(PROMPT)];
  for (const c of cams) {
    const file = stillsByCamera[c]!;
    parts.push(textPart(`Camera ${c}:`), mediaPart(readFileSync(file).toString("base64"), mimeFor(file)));
  }
  const out = await generateJson(MODELS.SCOUT, parts, ReplySchema, { purpose: "views", sceneId });

  for (const v of out.views) if (!cams.includes(v.camera)) throw new Error(`views: described camera ${v.camera}, which was not shown`);
  const views = cams.map((camera) => {
    const found = out.views.filter((v) => v.camera === camera);
    if (found.length !== 1) throw new Error(`views: camera ${camera} described ${found.length} times, expected once`);
    return { camera, text: found[0]!.text };
  });
  await writeJson(sceneId, "views.json", views);
  return views;
}
