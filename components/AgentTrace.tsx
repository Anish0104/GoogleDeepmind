// OWNER: Dev 4. The agent trace panel: each Investigator/Skeptic step, in order.
// In replay it reads agent-steps.jsonl; live it will read the same shape off Dev 3's stream.
import type { AgentStep, InspectWindowArgs, StopArgs } from "@/lib/types";

function isInspect(args: InspectWindowArgs | StopArgs): args is InspectWindowArgs {
  return "camera_id" in args;
}

function stepLine(step: AgentStep): string {
  if (step.action === "inspect_window" && isInspect(step.args)) {
    return `inspect CAM ${step.args.camera_id} ${step.args.start_s}–${step.args.end_s}s (${step.args.crop})`;
  }
  if (step.action === "rejected" && isInspect(step.args)) {
    return `rejected CAM ${step.args.camera_id} ${step.args.start_s}–${step.args.end_s}s`;
  }
  return "stop";
}

const DOT: Record<AgentStep["action"], string> = {
  inspect_window: "bg-sky-500",
  rejected: "bg-red-400",
  stop: "bg-neutral-400",
};

export function AgentTrace({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) {
    return <p className="text-sm text-neutral-400">No agent ran on this scene.</p>;
  }
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2 text-xs">
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[step.action]}`} />
          <div>
            <div className="text-neutral-700">
              <span className="font-mono text-neutral-400">{step.agent}</span>{" "}
              <span className="font-mono text-neutral-400">{step.claimId}#{step.n}</span>{" "}
              {stepLine(step)}
            </div>
            <div className="text-neutral-500">
              {step.action === "rejected" ? step.rejectionReason : step.args.reason}
            </div>
            <div className="font-mono text-neutral-400">
              {step.tokens} tok &middot; ${step.costUsd.toFixed(2)} &middot; {step.latencyMs}ms
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
