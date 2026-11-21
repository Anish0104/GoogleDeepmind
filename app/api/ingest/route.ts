// OWNER: Dev 1. Receives 1-second video chunks per camera (multipart: sceneId, camera, seq, chunk).
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Not implemented (owner: Dev 1)" }, { status: 501 });
}
