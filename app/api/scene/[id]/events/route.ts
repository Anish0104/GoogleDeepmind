// OWNER: Dev 3. Server-Sent Events for the board, read from the scene's files: "run", "result", "step".
// Full state on connect, then only changes; heartbeat every 15 s; closes when the client disconnects.
import { NextResponse } from "next/server";
import { scenePath } from "@/lib/store/scene";
import { sceneEventStream } from "@/lib/pipeline/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    scenePath(id); // rejects unsafe scene ids before opening a stream
  } catch {
    return NextResponse.json({ error: "invalid scene id" }, { status: 400 });
  }
  return new Response(sceneEventStream(id, { signal: req.signal }), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
