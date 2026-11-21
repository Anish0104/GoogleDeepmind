// OWNER: Dev 4. The agent trace card: each Investigator/Skeptic step that has happened by
// the replay clock. The newest reason types out. In replay it reads agent-steps.jsonl;
// live it will read the same shape off Dev 3's stream.
import { type TimedStep } from "@/components/replay/timeline";
import { AGENT_COLOR } from "./verdictStyle";

const DOT: Record<TimedStep["step"]["action"], string> = {
  inspect_window: "#7CC7FF",
  rejected: "#FF5A47",
  stop: "#7D838C",
};

export function AgentTrace({ steps, shown, T, end }: { steps: TimedStep[]; shown: TimedStep[]; T: number; end: number }) {
  return (
    <div className="rs-card" style={{ borderRadius: 16, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Agent trace</h2>
        <span className="rs-mono" style={{ fontSize: 12, color: "#7D838C" }}>
          {shown.length} / {steps.length} steps
        </span>
      </div>
      {steps.length === 0 ? (
        <p style={{ margin: "14px 0 0", fontSize: 13, color: "#7D838C", lineHeight: 1.5 }}>No agent ran on this scene.</p>
      ) : shown.length === 0 ? (
        <p style={{ margin: "14px 0 0", fontSize: 13, color: "#7D838C", lineHeight: 1.5 }}>
          Agents start after the footage pass. They pick extra clips to check, two follow-ups per claim.
        </p>
      ) : null}
      <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {shown.map((s, i) => {
          const last = i === shown.length - 1;
          const n = last ? Math.floor((T - s.at) * 55) : Infinity;
          const typing = last && n < s.reason.length && T < end;
          const dot = DOT[s.step.action];
          return (
            <li key={s.index} style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr)", gap: 10 }}>
              <span style={{ marginTop: 5, width: 8, height: 8, borderRadius: "50%", background: dot, boxShadow: `0 0 10px ${dot}` }} />
              <div style={{ minWidth: 0 }}>
                <div className="rs-mono" style={{ fontSize: 12, lineHeight: 1.45 }}>
                  <span style={{ color: AGENT_COLOR[s.step.agent] }}>{s.step.agent}</span>{" "}
                  <span style={{ color: "#7D838C" }}>
                    {s.step.claimId}#{s.step.n}
                  </span>{" "}
                  <span style={{ color: "#ECE6DA" }}>{s.line}</span>
                </div>
                <div style={{ marginTop: 3, fontSize: 13, lineHeight: 1.5, color: "#A9AEB5" }}>
                  {typing ? s.reason.slice(0, Math.max(0, n)) : s.reason}
                  {typing && <span className="rs-caret" />}
                </div>
                {s.blocked && !typing && (
                  <div className="rs-mono" style={{ display: "inline-block", marginTop: 6, padding: "2px 8px", border: "1px solid #FF5A47", color: "#FF5A47", fontSize: 11, letterSpacing: "0.16em", borderRadius: 3 }}>
                    LABEL CHANGE BLOCKED
                  </div>
                )}
                <div className="rs-mono" style={{ marginTop: 4, fontSize: 11, color: "#5E646D" }}>
                  {s.step.tokens} tok · ${s.step.costUsd.toFixed(2)} · {s.step.latencyMs}ms
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
