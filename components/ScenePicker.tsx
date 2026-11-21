// OWNER: Dev 4. Replay-mode scene picker: choose any saved scene to play on the board.
// Navigates by /board?scene=<dir>, which the board loads from files.
"use client";

import { useRouter } from "next/navigation";

export function boardHref(sceneDir: string): string {
  return `/board?scene=${encodeURIComponent(sceneDir)}`;
}

export function ScenePicker({ scenes, current }: { scenes: string[]; current: string }) {
  const router = useRouter();
  if (scenes.length <= 1) return null;
  return (
    <label className="rs-mono" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#7D838C" }}>
      replay
      <select
        value={current}
        onChange={(e) => router.push(boardHref(e.target.value))}
        className="rs-mono"
        style={{ borderRadius: 999, border: "1px solid rgba(236,230,218,0.18)", background: "#000", color: "#ECE6DA", padding: "6px 10px", fontSize: 12 }}
      >
        {scenes.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
