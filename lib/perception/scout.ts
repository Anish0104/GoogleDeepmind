// OWNER: Dev 1. Hydrogen scout: entities, plus yes/no questions from fixed patterns
// (location in zones A-F, heldBy, state, visible).
import type { Entity, Question } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export async function scout(
  _stillPaths: string[],
  _sceneId: string,
): Promise<{ entities: Entity[]; questions: Question[] }> {
  return notImplemented("Dev 1", "scout");
}
