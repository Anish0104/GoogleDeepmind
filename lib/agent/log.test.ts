// OWNER: Dev 3. Tests for logStep(): one AgentStep per line in agent-steps.jsonl.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentStep } from "@/lib/types";

let dataDir: string;
const prev = process.env.DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-log-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(async () => {
  if (prev === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prev;
  await rm(dataDir, { recursive: true, force: true });
});

it("appends each step to data/scenes/<id>/agent-steps.jsonl", async () => {
  const { logStep } = await import("@/lib/agent/log");
  const step = (n: number): AgentStep => ({
    agent: "investigator",
    claimId: "c1",
    n,
    action: "stop",
    args: { reason: "done" },
    tokens: 10,
    costUsd: 0.001,
    latencyMs: 5,
  });
  await logStep("s1", step(1));
  await logStep("s1", step(2));
  const rows = (await readFile(path.join(dataDir, "scenes", "s1", "agent-steps.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as AgentStep);
  expect(rows).toEqual([step(1), step(2)]);
});
