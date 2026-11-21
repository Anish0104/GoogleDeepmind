// OWNER: Dev 1. Test helper: video tests skip themselves where FFmpeg isn't installed (e.g. bare CI runners).
import { spawnSync } from "node:child_process";

export const HAS_FFMPEG = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"]).status === 0;
