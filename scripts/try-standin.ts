// OWNER: Dev 3. Manual check, not run in CI: one real stand-in turn against the Gemini API.
// Usage: pnpm tsx scripts/try-standin.ts [investigator|skeptic]
// Reads GEMINI_API_KEY (and STANDIN_MODEL / STANDIN_PRICE_*) from .env.local. Logs the call to COST_LOG.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentMenu, AgentName } from "@/lib/types";
import { assertBudget } from "@/lib/cost";
import { parseToolCall, validate } from "@/lib/agent/bridge";
import { SYSTEM_PROMPTS } from "@/lib/agent/prompts";
import { standinTurn } from "@/lib/agent/standin";
import { createGenaiModel, standinModelName } from "@/lib/agent/genai-turn";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const agent = (process.argv[2] ?? "investigator") as AgentName;
if (agent !== "investigator" && agent !== "skeptic") {
  console.error("Usage: pnpm tsx scripts/try-standin.ts [investigator|skeptic]");
  process.exit(1);
}

const fixture = path.join(process.cwd(), "fixtures/agent-menu.sample.json");
const menu: AgentMenu = { ...(JSON.parse(await readFile(fixture, "utf8")) as AgentMenu), agent };

await assertBudget();
console.log(`Model: ${standinModelName()} · agent: ${agent} · claim: "${menu.claim.text}"`);

const out = await standinTurn(SYSTEM_PROMPTS[agent], menu, [], createGenaiModel());
console.log("\nRaw tool call:");
console.log(JSON.stringify({ name: out.name, args: out.args }, null, 2));
console.log(`\nTokens: ${out.tokens} · cost: $${out.costUsd.toFixed(6)} · latency: ${out.latencyMs} ms`);

const parsed = parseToolCall(out.name, out.args);
if (!parsed.ok) {
  console.log(`\nBridge: REJECTED (malformed): ${parsed.reason}`);
} else if (parsed.call.name === "stop") {
  console.log(`\nBridge: stop: ${parsed.call.args.reason}`);
} else {
  const v = validate(parsed.call.args, menu);
  console.log(`\nBridge: ${v.ok ? "ACCEPTED" : `REJECTED: ${v.reason}`}`);
}
if (parsed.droppedFields.length) console.log(`Dropped fields: ${parsed.droppedFields.join(", ")}`);
