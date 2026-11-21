// OWNER: Dev 2. Carbon: a spoken account becomes Claim[] (actor, object, action, time window, precise or not).
import type { Claim } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export async function splitClaims(_transcript: string, _sceneId: string): Promise<Claim[]> {
  return notImplemented("Dev 2", "splitClaims");
}
