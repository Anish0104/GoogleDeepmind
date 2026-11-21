// OWNER: Dev 1. Browser-side helpers for the phone page (no React, so they can be unit tested).
import type { CameraId } from "@/lib/types";

/** Android/Chrome record webm; iPhone Safari only records mp4. */
export const MIME_PREFERENCE = [
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
] as const;

export function pickMimeType(isSupported: (mime: string) => boolean): string {
  return MIME_PREFERENCE.find((m) => isSupported(m)) ?? "";
}

export function extensionFor(mime: string): "webm" | "mp4" {
  return mime.startsWith("video/mp4") ? "mp4" : "webm";
}

export type UploadInput =
  | { sceneId: string; camera: CameraId; seq: number; blob: Blob; done?: undefined }
  | { sceneId: string; camera: CameraId; done: true };

export interface UploadDeps {
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
}

class PermanentError extends Error {}

/** Posts one chunk (or the done signal) to /api/ingest, retrying network errors and 5xx. */
export async function uploadChunk(input: UploadInput, deps: UploadDeps = {}): Promise<Record<string, unknown>> {
  const fetchFn = deps.fetchFn ?? ((url, init) => fetch(url, init));
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const attempts = deps.attempts ?? 6;

  for (let i = 1; ; i++) {
    const form = new FormData();
    form.append("sceneId", input.sceneId);
    form.append("camera", input.camera);
    if (input.done) form.append("done", "1");
    else {
      form.append("seq", String(input.seq));
      form.append("chunk", input.blob, `${input.seq}.${extensionFor(input.blob.type)}`);
    }
    try {
      const res = await fetchFn("/api/ingest", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) return body;
      const msg = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
      if (res.status < 500) throw new PermanentError(msg);
      throw new Error(msg);
    } catch (e) {
      if (e instanceof PermanentError || i >= attempts) throw e;
      await sleep(Math.min(8_000, 500 * 2 ** (i - 1)));
    }
  }
}
