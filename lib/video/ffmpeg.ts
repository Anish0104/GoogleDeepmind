// OWNER: Dev 1. FFmpeg wrapper (child_process.spawn). Raw video never leaves the laptop.
import { notImplemented } from "@/lib/not-implemented";

/** Cuts [startS, endS] from a local file; returns the output path. */
export async function clip(_input: string, _startS: number, _endS: number, _out: string): Promise<string> {
  return notImplemented("Dev 1", "clip");
}

/** Crops a region (pixels) from a clip or still; returns the output path. */
export async function crop(
  _input: string,
  _box: { x: number; y: number; w: number; h: number },
  _out: string,
): Promise<string> {
  return notImplemented("Dev 1", "crop");
}

/** Saves one low-res frame at timeS; returns the output path. */
export async function still(_input: string, _timeS: number, _out: string, _maxWidth = 512): Promise<string> {
  return notImplemented("Dev 1", "still");
}

/** Extracts mono PCM audio for clap sync; returns the output path. */
export async function audio(_input: string, _out: string, _sampleRate = 16_000): Promise<string> {
  return notImplemented("Dev 1", "audio");
}
