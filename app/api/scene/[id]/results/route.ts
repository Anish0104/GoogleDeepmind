// OWNER: Dev 2 (New Investigation UI). Read-only: the scene's saved claims and results (after the account and
// any agent updates), so the completion screen shows final persisted counts, plus the manifest summary and
// run.json so /new?scene=<id> can resume an investigation from its saved state. 404 unknown scene · 400 bad id.
import { NextResponse } from "next/server";
import { loadManifest, loadResults, NotFoundError, readJson, scenePath } from "@/lib/store/scene";
import type { RunStatus } from "@/lib/types";
import { readFile } from "node:fs/promises";
import { AGENT_STEPS_FILE } from "@/lib/agent/log";
import { loadClaims } from "@/lib/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    scenePath(id);
  } catch {
    return NextResponse.json({ error: "Invalid scene id." }, { status: 400 });
  }
  try {
    const m = await loadManifest(id);
    const run = await readJson<RunStatus>(id, "run.json").catch((e) => {
      if (e instanceof NotFoundError) return null;
      throw e;
    });
    const [claims, results] = await Promise.all([loadClaims(id), loadResults(id)]);
    const current = new Set(claims.map((c) => c.id));
    const manifest = { room: m.room, cameras: m.cameras, excludedCameras: m.excludedCameras, durationS: m.durationS, recorded: Object.keys(m.files ?? {}), presynced: m.presynced === true, questionSet: m.questionSet ?? null };
    // Whether agents have already run on this scene (agent-steps.jsonl has lines), so a resume does not rerun them.
    const steps = await readFile(scenePath(id, AGENT_STEPS_FILE), "utf8").catch(() => "");
    const agentsRan = claims.length > 0 && steps.trim().length > 0;
    return NextResponse.json({ sceneId: id, manifest, run, claims, results: results.filter((r) => current.has(r.claimId)), agentsRan });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: `Investigation ${id} not found.` }, { status: 404 });
    console.error(`[api/results] ${id}:`, e);
    return NextResponse.json({ error: "Could not read results." }, { status: 500 });
  }
}
