// OWNER: Dev 1. Pixel counts per object from SDG-Warehouse instance masks, for the visibility answer key.
// A camera's instance_id_segmentation.npz holds frames.npy: uint8 [T, H, W, 4], one RGBA instance id per
// pixel (id = R + G*256 + B*65536 + A*2^24). It is ~2.5 GB unpacked at 1080p, so it is streamed through
// `unzip -p` and only the requested frames are looked at. The matching *_mapping.jsonl has one line per
// frame mapping "(R, G, B, A)" to the object's USD prim path.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const HAS_UNZIP = spawnSync(process.env.UNZIP_PATH ?? "unzip", ["-v"]).status === 0;

export interface NpyHeader {
  shape: number[];
  dataOffset: number;
}

/** Header of a version 1/2 .npy holding uint8 in C order. Needs only the first bytes of the file. */
export function parseNpyHeader(buf: Buffer): NpyHeader {
  if (buf.length < 10 || buf.toString("latin1", 0, 6) !== "\x93NUMPY") throw new Error("not an .npy file");
  const major = buf[6]!;
  const lenBytes = major === 1 ? 2 : 4;
  const len = lenBytes === 2 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
  const start = 8 + lenBytes;
  if (buf.length < start + len) throw new Error(".npy header is cut off");
  const h = buf.toString("latin1", start, start + len);
  if (!/'descr':\s*'\|u1'/.test(h)) throw new Error(`.npy must hold uint8 (|u1): ${h.trim()}`);
  if (!/'fortran_order':\s*False/.test(h)) throw new Error(".npy must be in C order");
  const m = /'shape':\s*\(([^)]*)\)/.exec(h);
  if (!m) throw new Error(`.npy header has no shape: ${h.trim()}`);
  const shape = m[1]!.split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  return { shape, dataOffset: start + len };
}

/** Instance ids whose prim path starts with prefix, from one mapping line. */
export function idsFor(mappingLine: string, prefix: string): Set<number> {
  const map = JSON.parse(mappingLine) as Record<string, string>;
  const ids = new Set<number>();
  for (const [k, v] of Object.entries(map)) {
    if (!v.startsWith(prefix)) continue;
    const [r, g, b, a] = k.replace(/[()\s]/g, "").split(",").map(Number) as [number, number, number, number];
    ids.add(r + g * 256 + b * 65536 + a * 16777216);
  }
  return ids;
}

/** Pixels of an RGBA frame whose id is in ids. */
export function countIds(frame: Buffer, ids: Set<number>): number {
  if (ids.size === 0) return 0;
  let n = 0;
  for (let i = 0; i + 3 < frame.length; i += 4) if (ids.has(frame.readUInt32LE(i))) n++;
  return n;
}

export interface MaskCounts {
  width: number;
  height: number;
  frames: number;
  /** frame index -> entity name -> pixel count */
  counts: Map<number, Record<string, number>>;
}

/** Counts each entity's pixels (entity name -> prim path prefix) in the given frames of one camera's masks. */
export function maskCounts(
  npzPath: string,
  mappingPath: string,
  frames: number[],
  entities: Record<string, string>,
): Promise<MaskCounts> {
  const lines = readFileSync(mappingPath, "utf8").split("\n");
  const wanted = new Set(frames);
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.UNZIP_PATH ?? "unzip", ["-p", npzPath, "frames.npy"], { stdio: ["ignore", "pipe", "pipe"] });
    let head = Buffer.alloc(0);
    let header: NpyHeader | null = null;
    let frameBytes = 0;
    let pos = 0; // bytes of array data seen
    let cur: Buffer | null = null;
    let curIdx = -1;
    let stderr = "";
    let failed = false;
    const counts = new Map<number, Record<string, number>>();
    const fail = (e: Error) => {
      if (failed) return;
      failed = true;
      p.kill();
      reject(e);
    };

    const finishFrame = (idx: number, buf: Buffer) => {
      const line = lines[idx];
      if (line === undefined || line.trim() === "") return fail(new Error(`${mappingPath}: no mapping for frame ${idx}`));
      const rec: Record<string, number> = {};
      for (const [name, prefix] of Object.entries(entities)) rec[name] = countIds(buf, idsFor(line, prefix));
      counts.set(idx, rec);
    };

    const consume = (chunk: Buffer) => {
      let off = 0;
      while (off < chunk.length) {
        const idx = Math.floor(pos / frameBytes);
        const inFrame = pos % frameBytes;
        const take = Math.min(chunk.length - off, frameBytes - inFrame);
        if (wanted.has(idx)) {
          if (inFrame === 0) {
            cur = Buffer.allocUnsafe(frameBytes);
            curIdx = idx;
          }
          chunk.copy(cur!, inFrame, off, off + take);
          if (inFrame + take === frameBytes && curIdx === idx) {
            finishFrame(idx, cur!);
            cur = null;
          }
        }
        off += take;
        pos += take;
      }
    };

    p.stdout.on("data", (chunk: Buffer) => {
      if (failed) return;
      if (!header) {
        head = Buffer.concat([head, chunk]);
        if (head.length < 10) return;
        try {
          header = parseNpyHeader(head);
        } catch (e) {
          if (e instanceof Error && /cut off/.test(e.message)) return;
          return fail(e as Error);
        }
        const [, h, w, c] = header.shape;
        if (header.shape.length !== 4 || c !== 4) return fail(new Error(`${npzPath}: expected [T, H, W, 4], got [${header.shape}]`));
        frameBytes = h! * w! * 4;
        const rest = head.subarray(header.dataOffset);
        head = Buffer.alloc(0);
        if (rest.length) consume(rest);
        return;
      }
      consume(chunk);
    });
    p.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    p.on("error", (e) => fail(e));
    p.on("close", (code) => {
      if (failed) return;
      if (code !== 0) return fail(new Error(`unzip ${npzPath} exited ${code}: ${stderr.trim()}`));
      if (!header) return fail(new Error(`${npzPath}: frames.npy is empty`));
      const [T, H, W] = header.shape as [number, number, number];
      const missing = frames.filter((f) => !counts.has(f));
      if (missing.length) return fail(new Error(`${npzPath}: frame ${missing[0]} is outside 0-${T - 1}`));
      resolve({ width: W, height: H, frames: T, counts });
    });
  });
}
