# Submission

## What did you investigate first, and why?

I first looked through the core flow, then checked how the CLI and MCP actually call into it, what they accept, and what they return.

## What did you choose to implement or fix?

I mainly focused on making the tool safer and more useful in a real environment.

I hardened the Git handling, added limits/timeouts, and made sure AI failure falls back cleanly instead of breaking the review.

I also improved the actual Markdown output. It now gives a short summary, important changes, likely improvements, regression risks, validation results, and concise file details instead of mostly dumping changed files.

CLI and MCP still use the same core. AI is opt-in, and only bounded `git diff -U3` hunks are sent externally.

## What did you intentionally not do?

I did not give MCP arbitrary command execution or give the AI unrestricted access to the repository. I also kept the AI focused on explaining changes instead of turning this into a full AI code reviewer.

## Interface decision

Hybrid: the CLI gives local developers reliable, low-latency access and explicit validation, while MCP gives agents typed discovery and structured output without arbitrary command execution. Both share the same core, keeping context use and output consistent. I would switch away from hybrid if real usage showed one interface served both groups with equal or better reliability, latency, context efficiency, and output quality.

## How did you use an AI coding agent?

I used Codex to inspect the repo, implement changes, add tests, and help verify the CLI/MCP flows. I still checked the important security and interface decisions myself.

## Where did you check, correct, or reject an AI suggestion? (required)

I changed the AI design from sending whole source files to sending bounded `git diff -U3` hunks instead. This keeps the exact changes and a small amount of context without exposing unnecessary source.

## Commands used to verify the result, with outcomes

- `npm run typecheck` — passed.
- `npm test` — passed, 32 tests across 6 files.
- `npm run build` — passed.
- CLI review in deterministic mode — passed and generated Markdown.
- CLI review with a passing `--validate` command — exit 0 and reported both validations as passed.
- CLI review with a deliberately failing `--validate` command — exit 2 and reported the failed validation.
- OpenRouter was not run because no API key was available; I generated a representative report through the real renderer instead.
- MCP SDK check — passed, including root restrictions, AI permissions, structured output, and CLI/MCP output consistency.

## A blocker you hit and how you approached it

The main issue was making AI analysis useful without sending too much source code. `git diff -U3` works well, but new files can still expose most of their contents, so I added per-file/global limits and truncation tracking.

## Known limitations and the next three things you would do

Current limitations are that AI quality still needs real-world testing, bounded diffs can miss broader context, secret detection is heuristic, and MCP is still local stdio.

Next I would:

1. Run real OpenRouter reviews and evaluate the output quality.
2. Add authenticated remote/cloud agent endpoints.
3. Improve local context selection without just sending more source.

## Approximate focused-work time

- Start: 2026-08-16 13:48 EDT
- Finish: 2026-08-16 15:10 EDT
- Total: ~1h22m
