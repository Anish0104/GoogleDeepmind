// OWNER: Dev 4. The board — the live demo screen. Presentation over a ReplayScene, so the
// same component renders a live scene or a saved replay. Styling is deliberately plain: the
// UI gets renovated later, this just has to be correct and complete.
import type { ReplayScene } from "./loadScene";
import { CameraGrid } from "./CameraGrid";
import { ClaimRow } from "./ClaimRow";
import { AgentTrace } from "./AgentTrace";
import { CostMeter } from "./CostMeter";
import { ScenePicker } from "./ScenePicker";

export function Board({
  scene,
  scenes = [],
  sceneDir,
}: {
  scene: ReplayScene;
  scenes?: string[];
  sceneDir?: string;
}) {
  const { manifest, claims, results, grid, agentSteps, questions, spentUsd } = scene;
  const resultByClaim = new Map(results.map((r) => [r.claimId, r]));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">RASHOMON</h1>
          <p className="font-mono text-xs text-neutral-500">
            {manifest.sceneId} &middot; {manifest.room || "—"} &middot; {manifest.split} &middot;{" "}
            {manifest.durationS}s
            {manifest.plannedOcclusion ? " · planned occlusion" : ""}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {sceneDir && <ScenePicker scenes={scenes} current={sceneDir} />}
          <CostMeter spentUsd={spentUsd} />
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="space-y-6">
          <CameraGrid
            cameras={manifest.cameras}
            excludedInit={manifest.excludedCameras}
            grid={grid}
            questions={questions}
          />

          <div>
            <h2 className="mb-2 text-sm font-medium text-neutral-500">Claims</h2>
            <div className="space-y-3">
              {claims.map((claim) => (
                <ClaimRow key={claim.id} claim={claim} result={resultByClaim.get(claim.id)} />
              ))}
            </div>
          </div>
        </section>

        <aside>
          <h2 className="mb-2 text-sm font-medium text-neutral-500">Agent trace</h2>
          <AgentTrace steps={agentSteps} />
        </aside>
      </div>
    </main>
  );
}
