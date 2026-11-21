# Instructions for Claude Code in this repo

You are helping one of four developers build RASHOMON at the Gemini 4 NYC Hackathon. Read `README.md` and the brief for your developer in `docs/` before writing code.

## Ask first

At the start of a session, ask which developer you are working for (Dev 1-4) unless the user has said so. Only edit files that developer owns. The owner is in `README.md` and in the comment at the top of each file. If a change is needed in someone else's file, tell the user instead of editing it.

## Stack

Next.js App Router, TypeScript strict, pnpm, Vitest, zod, Tailwind, `@google/genai`, FFmpeg through `child_process.spawn`. Import shared types from `@/lib/types` and constants from `@/lib/config`.

## Rules

- Never change `lib/types.ts` without the user confirming the group agreed.
- Write the test first, then the code. Every exported function gets a Vitest test.
- Every model call goes through `lib/gemini/client.ts` so cost is logged.
- Parse every model JSON output and every agent tool call with a zod schema.
- Only `verdict()` in `lib/inference/verdict.ts` may set a label. Agents choose clips; they never decide labels.
- Agents must never receive labels of other claims, scripts, ground truth or excluded cameras.
- Keep raw video local. Only clips of 4 s or less and low-res stills go to models.
- Never commit video, `data/`, `logs/` or `.env.local`.
- Git commits carry the developer's name only. Do not add Co-Authored-By or any AI attribution lines to commit messages or PR descriptions.
- Run `pnpm typecheck` and `pnpm test` before saying a task is done.
