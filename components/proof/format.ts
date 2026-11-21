// OWNER: Dev 4. Small formatting helpers for the Proof screen.

/** Where a clip is served from: public/clips/<sceneId>/<clipId>.webm. */
export function clipSrc(sceneId: string, clipId: string): string {
  return `/clips/${encodeURIComponent(sceneId)}/${encodeURIComponent(clipId)}.webm`;
}

/** "15:31:02" from an ISO time (UTC), or the raw value when it isn't one. */
export function clockTime(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toISOString().slice(11, 19);
}
