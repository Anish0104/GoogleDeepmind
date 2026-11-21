// OWNER: Dev 2. Carbon answers a question with a timeline. Every sentence must cite cameras and times;
// code rejects any sentence without a citation and asks again.
import type { CameraId, Event, GridRow } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export interface CitedSentence {
  text: string;
  citations: { camera: CameraId; window: [number, number] }[];
}

export async function judge(_question: string, _events: Event[], _rows: GridRow[]): Promise<CitedSentence[]> {
  return notImplemented("Dev 2", "judge");
}
