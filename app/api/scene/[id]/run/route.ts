// OWNER: Dev 3. Starts the scene run in the background: probe -> perceiveScene() -> stills.json.
// 202 {sceneId, status: "queued"} right away; progress in run.json, ending at status "perceived".
// 409 while the scene is held (another run, the account or an agent run) · 404 unknown scene · 400 bad id.
// Labels come from POST .../account (Dev 2); agents from POST .../agents.
import { NextResponse } from "next/server";
import { handleRunStart } from "@/lib/api/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, body } = await handleRunStart(id);
  return NextResponse.json(body, { status });
}
