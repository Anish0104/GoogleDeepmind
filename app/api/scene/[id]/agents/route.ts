// OWNER: Dev 3. Runs the eligible agent (Investigator or Skeptic) for every claim, one claim at a time.
// 200 {sceneId, claims: [{claimId, agent?, ran, reason?, mode, before, after, stopReason?}]}
// 409 while the scene is held (the run, the account or another agent run) · 404 unknown scene or no claims yet.
import { NextResponse } from "next/server";
import { handleAgentsRun } from "@/lib/api/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, body } = await handleAgentsRun(id);
  return NextResponse.json(body, { status });
}
