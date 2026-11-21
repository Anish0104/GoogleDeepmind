// OWNER: Dev 3. Runs the Investigator on one claim on demand, through startAgent() (respects AGENT_MODE).
// Input: {sceneId, claimId}. Output: 200 {ran: true, steps, result, stopReason, mode} or 200 {ran: false, reason}
// when the claim isn't eligible; 409 while the scene has a run in progress (shared lock with the pipeline).
import { NextResponse } from "next/server";
import { handleAgentRequest } from "@/lib/api/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  const { status, body: out } = await handleAgentRequest("investigator", body);
  return NextResponse.json(out, { status });
}
