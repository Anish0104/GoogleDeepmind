# Dev 3: Agents & Platform (Anish)

Owns both Gemini Managed Agents, the bridge they work through, and the platform everyone builds on.

## You own

Repo config, `lib/types.ts` (contract keeper), `lib/store/`, `lib/cost.ts`, `lib/agent/`, `app/api/scene/start/`, `app/api/scene/[id]/run/`, `app/api/scene/[id]/stream/`, `app/api/investigate/`, `app/api/skeptic/`, `app/api/cost/`, `eval/agents-compare.ts`, `scripts/killtests/g.ts`, `h.ts`.

## Build, in order

1. Scene store (`lib/store/scene.ts`): scene state saved to `data/scenes/<id>/`.
2. Pipeline runner (`/api/scene/[id]/run`) that calls each dev's functions in order, and the Server-Sent Events stream (`/api/scene/[id]/stream`) for Dev 4's board.
3. Stand-in agent (`lib/agent/standin.ts`): an ordinary model call with the same two tools, so the bridge and the board never wait for the real agent. Works on the free tier.
4. Bridge (`lib/agent/bridge.ts`): reject unless the camera is included, the window is inside the allowed range and 1-4 s long, not already checked, and follow-ups are left. A rejection still uses a check. Then call Dev 1's `checkWindow()`, Dev 2's auditor and `verdict()`.
5. Menu builder (`menu.ts`), log (`log.ts`), environment (`environment.ts`), shared loop (`loop.ts`).
6. Investigator (`investigator.ts`): the real Managed Agent through the Interactions API. One environment per scene, created at scene start; tools limited to `inspect_window` and `stop`; `max_total_tokens` set; at most 2 checks.
7. Skeptic (`skeptic.ts`): same tools and loop; runs on every Contradicted label and on weak Supported labels (`isWeakSupport()`); results go through `enforceDowngradeOnly()`.
8. Cost meter (`lib/cost.ts`, `/api/cost`): hard stop at `BUDGET_HARD_STOP_USD`.
9. Agent comparison (`eval/agents-compare.ts`): Investigator off / fixed rule / stand-in / managed agent; Skeptic off / on; same 2-check budget.

## First 30 minutes at the event

Confirm the Interactions API field names for tool results and resuming an environment, whether the agent accepts image input, whether `agent_config` accepts Hydrogen, and tokens per run. Managed agents may not be on the free tier: build everything against the stand-in tonight and switch when credits arrive.

## Kill tests

- **G:** a real managed agent picks a valid clip, uses the result, then stops or picks again.
- **H:** on 10 decided claims (5 right, 5 wrong): 0 right labels changed, 0 new Contradicted, at least 3 of 5 wrong labels downgraded. If it fails, ship the Investigator alone.

## Prompt for Claude Code

> I'm Dev 3 (Agents & Platform) on RASHOMON. Read CLAUDE.md, README.md, lib/types.ts, lib/config.ts and docs/DEV3-agents-platform.md. I only edit the files listed under "You own". Start with lib/agent/bridge.ts: write Vitest tests for every validation rule first, then implement validate() against AgentMenu and InspectWindowArgs from lib/types.ts. Then build the stand-in agent with the same two tools so the loop works on the free tier. Validate every tool call with zod.
