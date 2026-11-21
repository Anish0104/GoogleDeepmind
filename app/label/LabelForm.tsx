// OWNER: Dev 4. Client form for one labeler. Shows claims only — never system output.
"use client";

import { useState } from "react";
import type { Verdict } from "@/lib/types";
import { saveLabeling, type LabelEntry } from "./actions";

const CHOICES: Verdict[] = ["Supported", "Contradicted", "Insufficient"];

export interface LabelClaim {
  id: string;
  text: string;
  window: [number, number];
}

export function LabelForm({ sceneId, claims }: { sceneId: string; claims: LabelClaim[] }) {
  const [labeler, setLabeler] = useState("");
  const [picks, setPicks] = useState<Record<string, Verdict>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allLabelled = claims.length > 0 && claims.every((c) => picks[c.id]);

  async function submit() {
    setSaving(true);
    setStatus(null);
    const entries: LabelEntry[] = claims
      .filter((c) => picks[c.id])
      .map((c) => ({ claimId: c.id, label: picks[c.id]!, note: notes[c.id]?.trim() || undefined }));
    const res = await saveLabeling({ sceneId, labeler, at: "", entries });
    setStatus(res.message);
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm text-neutral-600">Your name (labeler)</span>
        <input
          className="mt-1 w-64 rounded border border-neutral-300 px-2 py-1 text-sm"
          value={labeler}
          onChange={(e) => setLabeler(e.target.value)}
          placeholder="e.g. ana"
        />
      </label>

      <ol className="space-y-3">
        {claims.map((claim) => (
          <li key={claim.id} className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className="text-sm text-neutral-900">&ldquo;{claim.text}&rdquo;</div>
            <div className="font-mono text-xs text-neutral-400">
              {claim.id} &middot; {claim.window[0]}&ndash;{claim.window[1]}s
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {CHOICES.map((choice) => {
                const active = picks[claim.id] === choice;
                return (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => setPicks((p) => ({ ...p, [claim.id]: choice }))}
                    className={[
                      "rounded border px-2.5 py-1 text-xs",
                      active
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100",
                    ].join(" ")}
                  >
                    {choice}
                  </button>
                );
              })}
            </div>
            <input
              className="mt-2 w-full rounded border border-neutral-200 px-2 py-1 text-xs"
              value={notes[claim.id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [claim.id]: e.target.value }))}
              placeholder="note (optional)"
            />
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving || !labeler.trim() || !allLabelled}
          onClick={submit}
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Submit labels"}
        </button>
        {!allLabelled && <span className="text-xs text-neutral-400">Label every claim to submit.</span>}
        {status && <span className="text-xs text-neutral-600">{status}</span>}
      </div>
    </div>
  );
}
