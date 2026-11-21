// OWNER: Dev 4. Runs the pipeline over a split. The held-out split is run exactly once.
// Usage: pnpm eval:run --split dev
import { notImplemented } from "@/lib/not-implemented";

export async function runSplit(_split: "dev" | "heldout"): Promise<void> {
  notImplemented("Dev 4", "runSplit");
}
