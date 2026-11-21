// OWNER: Dev 3. Creates manifest.json for a new scene.
// Input: {split, room, cameras, excludedCameras, plannedOcclusion?}. Output: 201 {sceneId}.
// files and durationS are filled in by the pipeline's probe stage once the recordings are in.
import { NextResponse } from "next/server";
import { handleSceneStart } from "@/lib/api/handlers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  const { status, body: out } = await handleSceneStart(body);
  return NextResponse.json(out, { status });
}
