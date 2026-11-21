# Working in this repo

## The three rules

1. **Every file has one owner.** Anyone may import and call a function; only its owner edits the file. Ownership is in `README.md` and at the top of each file.
2. **`lib/types.ts` is the contract.** Changes need a quick OK from the group, then Dev 3 makes them.
3. **Never wait.** If you need someone's function before it works, call the stub and use data from `fixtures/`, or write a temporary stub with the same signature in your own folder and delete it at the next merge.

## Git

- One branch per person: `dev1/<topic>`, `dev2/<topic>`, `dev3/<topic>`, `dev4/<topic>`.
- Pull `main` before each task. Commit small and often.
- Merge to `main` only at the merge points (M1-M5 in the roles doc), after `pnpm typecheck` and `pnpm test` pass.
- Never commit video, `data/`, `logs/` or `.env.local`. Share footage through the team Drive folder.
- Commit messages: your own name only, no AI co-author or attribution lines.

## Safety rules nobody breaks

- Only `verdict()` sets a label. No model and no agent decides a label.
- A low score, a disagreement or a missing view means Insufficient, never Contradicted.
- We label claims, never people.
- Agents only see what `lib/agent/menu.ts` builds: never labels, scripts, ground truth or excluded cameras.
- Thresholds are frozen before the held-out run, and the held-out set is run exactly once.
- We never state a number we didn't measure.

## Budget

- Free tier until the event credits arrive. Keep `MAX_CONCURRENT_CALLS` low, use `fixtures/` for development, and only call real models when you need to.
- Every model call goes through `lib/gemini/client.ts`, which logs tokens and dollars to `logs/costs.jsonl`.
- The board stops agents at `BUDGET_HARD_STOP_USD` ($8).
