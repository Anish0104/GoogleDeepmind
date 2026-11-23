// OWNER: Dev 4. One claim on the board: its text, the label it has at the replay clock
// ("queued" / "reading…" before that), and a note when an agent touched it. Click opens
// the claim's Proof page (clips, per-camera evidence and the full label history).
import Link from "next/link";
import type { Claim, Verdict } from "@/lib/types";
import { winTxt } from "@/components/canvas/math";
import type { ClaimNote } from "@/components/replay/timeline";
import { verdictStyle } from "./verdictStyle";

export function ClaimRow({
  claim,
  verdict,
  note,
  T,
  href,
}: {
  claim: Claim;
  verdict: Verdict | null;
  note: ClaimNote | null;
  T: number;
  href: string;
}) {
  const s = verdict ? verdictStyle(verdict) : null;
  return (
    <Link
      href={href}
      className="rs-hover-border"
      style={{
        display: "block",
        textAlign: "left",
        background: s ? s.bg : "var(--bg-card)",
        border: `1px solid ${s ? s.border : "var(--border-card)"}`,
        borderRadius: 12,
        padding: 14,
        color: "var(--text-ink)",
        transition: "background .4s cubic-bezier(.22,1,.36,1),border-color .4s cubic-bezier(.22,1,.36,1)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <span style={{ fontSize: 18, lineHeight: 1.25, color: "var(--text-ink)" }}>&ldquo;{claim.text}&rdquo;</span>
        {s ? (
          <span className="rs-mono" style={{ flex: "none", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", padding: "4px 8px", borderRadius: 5, border: `1px solid ${s.color}`, color: s.color }}>
            {s.mark} {s.label}
          </span>
        ) : (
          <span className="rs-mono rs-shimmer" style={{ flex: "none", fontSize: 11, padding: "4px 8px", borderRadius: 5, color: "var(--text-muted)" }}>
            {T < claim.window[0] ? "queued" : "reading…"}
          </span>
        )}
      </div>
      <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
        <span>
          {claim.id} · {winTxt(claim.window)}
          {claim.timeIsPrecise ? "" : " · approx"}
        </span>
        {note && <span style={{ color: note.color }}>{note.text}</span>}
      </div>
    </Link>
  );
}
