"use client";
// OWNER: Dev 1. Records the camera with MediaRecorder and streams 1-second chunks to /api/ingest.
// Also keeps every chunk in memory so the phone can save a full local copy if Wi-Fi fails.
import { useEffect, useRef, useState } from "react";
import type { CameraId } from "@/lib/types";
import { extensionFor, pickMimeType, uploadChunk } from "./capture";

type Status = "idle" | "ready" | "recording" | "finishing" | "done" | "error";

interface Props {
  sceneId: string;
  camera: CameraId;
}

export default function PhoneCapture({ sceneId, camera }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const seqRef = useRef(0);
  const wakeRef = useRef<{ release(): Promise<void> } | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(0);
  const [queued, setQueued] = useState(0);
  const [failed, setFailed] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [mime, setMime] = useState("");

  useEffect(() => {
    if (status !== "recording") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [status]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void wakeRef.current?.release();
    },
    [],
  );

  async function enableCamera() {
    setError(null);
    try {
      if (!window.isSecureContext) throw new Error("This page must be opened over HTTPS for camera access.");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        // Processing would flatten the clap transient that sync relies on.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      const picked = pickMimeType((m) => MediaRecorder.isTypeSupported(m));
      if (!picked) throw new Error("This browser cannot record webm or mp4 video.");
      setMime(picked);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function enqueue(blob: Blob, seq: number) {
    setQueued((q) => q + 1);
    queueRef.current = queueRef.current
      .then(() => uploadChunk({ sceneId, camera, seq, blob }))
      .then(() => setSent((s) => s + 1))
      .catch((e: unknown) => {
        setFailed((f) => f + 1);
        setError(`Chunk ${seq} failed: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => setQueued((q) => q - 1));
  }

  async function start() {
    const stream = streamRef.current;
    if (!stream) return;
    setError(null);
    chunksRef.current = [];
    seqRef.current = 0;
    setSent(0);
    setFailed(0);
    setSummary(null);
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalUrl(null);

    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      const blob = e.data.type ? e.data : new Blob([e.data], { type: mime });
      chunksRef.current.push(blob);
      enqueue(blob, seqRef.current++);
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setStartedAt(Date.now());
    setStatus("recording");
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
      wakeRef.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      // Wake lock is optional.
    }
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setStatus("finishing");
    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });
    void wakeRef.current?.release();
    wakeRef.current = null;

    const all = new Blob(chunksRef.current, { type: mime });
    setLocalUrl(URL.createObjectURL(all));

    await queueRef.current;
    try {
      const res = await uploadChunk({ sceneId, camera, done: true });
      const missing = Array.isArray(res.missing) ? res.missing.length : 0;
      const dur = typeof res.durationS === "number" ? res.durationS.toFixed(1) : "?";
      setSummary(`Saved ${String(res.chunks)} chunks, ${dur} s${missing ? `, ${missing} missing` : ""}.`);
      setStatus("done");
    } catch (e) {
      setError(`Could not finish upload: ${e instanceof Error ? e.message : String(e)}. Save the local copy.`);
      setStatus("error");
    }
  }

  function syncFlash() {
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 2000;
      gain.gain.value = 1;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
      osc.onended = () => void ctx.close();
    } catch {
      // Beep is optional; the flash is the marker.
    }
  }

  const elapsed = startedAt && status === "recording" ? Math.floor((now - startedAt) / 1000) : 0;
  const ext = extensionFor(mime);

  return (
    <main className="flex min-h-screen flex-col bg-black text-white">
      {flash && <div className="fixed inset-0 z-50 bg-white" />}

      <header className="flex items-center justify-between px-4 py-3 text-sm">
        <span className="font-semibold">
          Scene {sceneId} · Camera {camera}
        </span>
        {status === "recording" && (
          <span className="flex items-center gap-2 text-red-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          </span>
        )}
      </header>

      <video ref={videoRef} muted playsInline className="w-full flex-1 bg-neutral-900 object-contain" />

      <section className="space-y-3 px-4 py-4">
        <p className="text-xs text-neutral-400">
          Uploaded {sent} · waiting {queued}
          {failed > 0 && <span className="text-red-400"> · failed {failed}</span>}
          {mime && <span> · {mime.split(";")[0]}</span>}
        </p>

        {error && <p className="rounded bg-red-900/60 p-2 text-sm">{error}</p>}
        {summary && <p className="rounded bg-green-900/60 p-2 text-sm">{summary}</p>}

        <div className="grid grid-cols-2 gap-3">
          {(status === "idle" || status === "error") && !streamRef.current && (
            <button onClick={enableCamera} className="col-span-2 rounded-lg bg-white py-4 font-semibold text-black">
              Enable camera
            </button>
          )}
          {(status === "ready" || status === "done" || (status === "error" && streamRef.current)) && (
            <button onClick={start} className="col-span-2 rounded-lg bg-red-600 py-4 font-semibold">
              Start recording
            </button>
          )}
          {status === "recording" && (
            <>
              <button onClick={syncFlash} className="rounded-lg bg-white py-4 font-semibold text-black">
                Flash
              </button>
              <button onClick={stop} className="rounded-lg bg-neutral-700 py-4 font-semibold">
                Stop
              </button>
            </>
          )}
          {status === "finishing" && (
            <p className="col-span-2 py-4 text-center text-sm text-neutral-300">Finishing upload…</p>
          )}
        </div>

        {localUrl && (
          <a
            href={localUrl}
            download={`${sceneId}-cam-${camera}.${ext}`}
            className="block rounded-lg border border-neutral-600 py-3 text-center text-sm"
          >
            Save local copy
          </a>
        )}

        <p className="text-xs text-neutral-500">
          After everyone starts: clap once where all cameras can see and hear it, then press Flash on one phone held
          up to the cameras.
        </p>
      </section>
    </main>
  );
}
