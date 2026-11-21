// OWNER: Dev 1. Synthetic multi-camera recordings with a clap + flash at known times
// (sync tests and kill test F). Same idea as shifting Panoptic videos by known offsets.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface SyntheticCamera {
  file: string;
  /** Local time (s) of the clap + start flash in this camera's recording. */
  eventAtS: number;
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400)))));
  });
}

/**
 * Writes one webm per camera into dir (cam-A.webm, ...). Every camera sees the same scene events:
 * a clap + 0.3 s flash at eventAtS, a knock 2 s later, and a closing flash endGapS after the first.
 * Cameras differ only in when they started recording, i.e. in eventAtS.
 */
export async function makeSyncFixture(
  dir: string,
  eventAtS: Partial<Record<"A" | "B" | "C" | "D", number>>,
  opts: { durationS?: number; endGapS?: number } = {},
): Promise<Record<string, SyntheticCamera>> {
  const durationS = opts.durationS ?? 12;
  const endGap = opts.endGapS ?? 7;
  mkdirSync(dir, { recursive: true });
  const out: Record<string, SyntheticCamera> = {};
  await Promise.all(
    Object.entries(eventAtS).map(async ([cam, at]) => {
      const file = path.join(dir, `cam-${cam}.webm`);
      const flash = (s: number) => `drawbox=x=40:y=20:w=80:h=60:color=white:t=fill:enable='between(t,${s},${s + 0.3})'`;
      const burst = (s: number, amp: number) => `if(gte(t,${s}),${amp}*exp(-(t-${s})*60)*sin(2*PI*900*t+40*sin(2*PI*37*t)),0)`;
      await ffmpeg([
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `color=c=0x303030:s=320x180:r=30:d=${durationS}`,
        "-f", "lavfi", "-i", `aevalsrc='${burst(at, 0.9)}+${burst(at + 2, 0.5)}':s=48000:d=${durationS}`,
        "-vf", `${flash(at)},${flash(at + endGap)}`,
        "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "200k", "-c:a", "libopus", "-shortest", file,
      ]);
      out[cam] = { file, eventAtS: at };
    }),
  );
  return out;
}
