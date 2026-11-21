// OWNER: Dev 4. Replay-mode scene picker: choose any saved scene to play on the board.
// Navigates by ?scene=<dir>, which the board loads from files.
"use client";

import { useRouter } from "next/navigation";

export function ScenePicker({ scenes, current }: { scenes: string[]; current: string }) {
  const router = useRouter();
  if (scenes.length <= 1) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-500">
      replay
      <select
        value={current}
        onChange={(e) => router.push(`/?scene=${encodeURIComponent(e.target.value)}`)}
        className="rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs text-neutral-800"
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
