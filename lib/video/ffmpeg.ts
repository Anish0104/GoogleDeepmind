// OWNER: Dev 1. FFmpeg wrapper (child_process.spawn). Raw video never leaves the laptop.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { LIMITS } from "@/lib/config";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

/** Clips sent to models are scaled down to this width. */
const CLIP_MAX_WIDTH = 640;

function runRaw(bin: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${bin} exited ${code}: ${stderr.trim().slice(-500)}`));
    });
  });
}

const run = async (bin: string, args: string[]) => (await runRaw(bin, args)).toString();

async function ffmpeg(args: string[], out: string): Promise<string> {
  mkdirSync(path.dirname(out), { recursive: true });
  await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args, out]);
  // FFmpeg exits 0 without writing anything when a seek lands past the end.
  if (!existsSync(out) || statSync(out).size === 0) throw new Error(`ffmpeg produced no output: ${out}`);
  return out;
}

const t = (s: number) => s.toFixed(3);

const isImage = (file: string) => /\.(jpe?g|png|webp)$/i.test(file);

const ProbeSchema = z.object({
  format: z.object({ duration: z.string().optional() }).optional(),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      sample_rate: z.string().optional(),
      channels: z.number().optional(),
    }),
  ),
});

export interface ProbeResult {
  durationS: number; // 0 for stills or when the container has no duration
  width?: number;
  height?: number;
  hasAudio: boolean;
  sampleRate?: number;
  channels?: number;
}

/** Reads duration, frame size and audio format with ffprobe. */
export async function probe(input: string): Promise<ProbeResult> {
  const raw = await run(FFPROBE, ["-v", "error", "-of", "json", "-show_format", "-show_streams", input]);
  const p = ProbeSchema.parse(JSON.parse(raw));
  const v = p.streams.find((s) => s.codec_type === "video");
  const a = p.streams.find((s) => s.codec_type === "audio");
  const duration = Number(p.format?.duration);
  return {
    durationS: Number.isFinite(duration) ? duration : 0,
    ...(v?.width !== undefined ? { width: v.width } : {}),
    ...(v?.height !== undefined ? { height: v.height } : {}),
    hasAudio: a !== undefined,
    ...(a?.sample_rate !== undefined ? { sampleRate: Number(a.sample_rate) } : {}),
    ...(a?.channels !== undefined ? { channels: a.channels } : {}),
  };
}

/**
 * Cuts [startS, endS] from a local file to a small silent H.264 mp4; returns the output path.
 * Refuses windows over LIMITS.CLIP_MAX_S, since clips are what get sent to models.
 */
export async function clip(input: string, startS: number, endS: number, out: string): Promise<string> {
  const dur = endS - startS;
  if (!(startS >= 0) || !(dur > 0)) throw new Error(`invalid clip window [${startS}, ${endS}]`);
  if (dur > LIMITS.CLIP_MAX_S + 1e-6) throw new Error(`clip is ${dur}s; max is ${LIMITS.CLIP_MAX_S}s`);
  return ffmpeg(
    [
      "-ss", t(startS), "-i", input, "-t", t(dur),
      "-vf", `scale='min(${CLIP_MAX_WIDTH},iw)':-2`,
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
    ],
    out,
  );
}

/** Crops a region (pixels) from a clip or still; returns the output path. */
export async function crop(
  input: string,
  box: { x: number; y: number; w: number; h: number },
  out: string,
): Promise<string> {
  const { x, y, w, h } = box;
  if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 2 || h < 2) {
    throw new Error(`invalid crop box ${JSON.stringify(box)}`);
  }
  const vf = `crop=${w}:${h}:${x}:${y}`;
  if (isImage(input)) return ffmpeg(["-i", input, "-vf", vf, "-frames:v", "1", "-q:v", "4"], out);
  return ffmpeg(
    ["-i", input, "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p"],
    out,
  );
}

/** Saves one low-res frame at timeS; returns the output path. */
export async function still(input: string, timeS: number, out: string, maxWidth = 512): Promise<string> {
  if (!(timeS >= 0)) throw new Error(`invalid still time ${timeS}`);
  return ffmpeg(
    ["-ss", t(timeS), "-i", input, "-frames:v", "1", "-vf", `scale='min(${maxWidth},iw)':-2`, "-q:v", "4"],
    out,
  );
}

/** Extracts mono 16-bit PCM audio (wav) for clap sync; returns the output path. */
export async function audio(input: string, out: string, sampleRate = 16_000): Promise<string> {
  return ffmpeg(["-i", input, "-vn", "-ac", "1", "-ar", String(sampleRate), "-c:a", "pcm_s16le"], out);
}

/** Rewrites the container without re-encoding: fixes the missing duration and index in browser recordings. */
export async function remux(input: string, out: string): Promise<string> {
  if (path.resolve(input) === path.resolve(out)) throw new Error("remux: output must differ from input");
  const extra = /\.mp4$/i.test(out) ? ["-movflags", "+faststart"] : [];
  return ffmpeg(["-i", input, "-map", "0", "-c", "copy", ...extra], out);
}

/**
 * Decodes the video as tiny grayscale frames at a constant fps (frame k is at k / fps seconds).
 * Used for flash detection; each frame is width*height bytes of luma.
 */
export async function grayFrames(
  input: string,
  width = 32,
  height = 18,
  fps = 30,
): Promise<{ fps: number; width: number; height: number; frames: Uint8Array[] }> {
  const buf = await runRaw(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-i", input, "-an",
    "-vf", `${isImage(input) ? "" : `fps=${fps},`}scale=${width}:${height}:flags=area,format=gray`,
    "-f", "rawvideo", "pipe:1",
  ]);
  const size = width * height;
  const frames: Uint8Array[] = [];
  for (let off = 0; off + size <= buf.length; off += size) frames.push(new Uint8Array(buf.subarray(off, off + size)));
  return { fps, width, height, frames };
}

/**
 * Cuts [startS, startS + count * segS) into `count` silent low-res mp4 segments of segS each,
 * written as <dir>/00000.mp4, 00001.mp4, ... Returns the paths in order.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const validBox = ({ x, y, w, h }: Box) => [x, y, w, h].every(Number.isInteger) && x >= 0 && y >= 0 && w >= 2 && h >= 2;

export async function segments(
  input: string,
  startS: number,
  segS: number,
  count: number,
  dir: string,
  opts: { crop?: Box } = {},
): Promise<string[]> {
  if (!(startS >= 0) || !(segS > 0) || !(segS <= LIMITS.CLIP_MAX_S) || !Number.isInteger(count) || count < 1) {
    throw new Error(`invalid segments(${startS}, ${segS}, ${count})`);
  }
  if (opts.crop && !validBox(opts.crop)) throw new Error(`invalid crop box ${JSON.stringify(opts.crop)}`);
  // A crop is scaled up to the full clip width so small objects fill more of what the model sees.
  const view = opts.crop
    ? `crop=${opts.crop.w}:${opts.crop.h}:${opts.crop.x}:${opts.crop.y},scale=${CLIP_MAX_WIDTH}:-2`
    : `scale='min(${CLIP_MAX_WIDTH},iw)':-2`;
  mkdirSync(dir, { recursive: true });
  await run(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", t(startS), "-i", input, "-t", t(segS * count), "-an",
    "-vf", `fps=30,${view}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p",
    "-force_key_frames", `expr:gte(t,n_forced*${segS})`,
    "-f", "segment", "-segment_time", String(segS), "-segment_time_delta", "0.02", "-reset_timestamps", "1", "-segment_format", "mp4",
    path.join(dir, "%05d.mp4"),
  ]);
  const paths = Array.from({ length: count }, (_, i) => path.join(dir, `${String(i).padStart(5, "0")}.mp4`));
  const made = paths.filter((p) => existsSync(p));
  if (made.length === 0) throw new Error(`ffmpeg produced no segments in ${dir}`);
  return made;
}

/**
 * Trims [startS, startS + durationS] and re-encodes it as a silent VP8 webm at a fixed fps and height
 * (used to bring external footage, e.g. 60 fps 1080p, to the phone-recording format).
 */
export async function transcode(
  input: string,
  out: string,
  o: { startS: number; durationS: number; fps: number; height: number },
): Promise<string> {
  if (!(o.startS >= 0) || !(o.durationS > 0) || !(o.fps > 0) || !Number.isInteger(o.height) || o.height < 2) {
    throw new Error(`invalid transcode window ${JSON.stringify(o)}`);
  }
  return ffmpeg(
    [
      "-ss", t(o.startS), "-i", input, "-t", t(o.durationS), "-an",
      "-vf", `fps=${o.fps},scale=-2:${o.height}`,
      "-c:v", "libvpx", "-deadline", "good", "-cpu-used", "4", "-b:v", "2500k",
    ],
    out,
  );
}

/** Joins clips with identical encoding (e.g. consecutive segments) into one file, without re-encoding. */
export async function concat(inputs: string[], out: string): Promise<string> {
  if (inputs.length === 0) throw new Error("concat needs at least one input");
  const list = `${out}.list.txt`;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(list, inputs.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  try {
    return await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy"], out);
  } finally {
    rmSync(list, { force: true });
  }
}

/** Saves one low-res still every everyS seconds from startS: <dir>/00000.jpg, ... Returns the paths in order. */
export async function stills(
  input: string,
  startS: number,
  everyS: number,
  count: number,
  dir: string,
  maxWidth = 512,
): Promise<string[]> {
  if (!(startS >= 0) || !(everyS > 0) || !Number.isInteger(count) || count < 1) {
    throw new Error(`invalid stills(${startS}, ${everyS}, ${count})`);
  }
  mkdirSync(dir, { recursive: true });
  await run(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", t(startS), "-i", input, "-t", t(everyS * count), "-an",
    "-vf", `select='gte(t\\,selected_n*${everyS}-0.001)',scale='min(${maxWidth},iw)':-2`,
    "-fps_mode", "vfr", "-q:v", "5", "-start_number", "0", "-frames:v", String(count),
    path.join(dir, "%05d.jpg"),
  ]);
  return Array.from({ length: count }, (_, i) => path.join(dir, `${String(i).padStart(5, "0")}.jpg`)).filter((p) =>
    existsSync(p),
  );
}
