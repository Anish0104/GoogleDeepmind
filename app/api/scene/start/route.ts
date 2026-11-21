// OWNER: Dev 3. Creates manifest.json and the scene's agent environment (so it's warm).
// Input: {split, room, cameras, excludedCameras}. Output: {sceneId, environmentId}.
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Not implemented (owner: Dev 3)" }, { status: 501 });
}
