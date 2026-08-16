# Submission

## What did you investigate first, and why?
I traced the shared core, CLI, MCP, Git inspection, validation, and report generation to understand the contracts and trust boundaries before changing them.

## What did you choose to implement or fix?

I hardened the production path: Git parsing and ref correctness, bounded subprocess and provider behavior, and deterministic fallback when AI is disabled, unavailable, invalid, or fails. Deterministic Git inspection remains authoritative.

I kept CLI and MCP on one shared core with consistent contracts. External AI is opt-in and receives only bounded `git diff -U3` evidence; MCP AI requires both server/operator permission and a client request. Optional bounded CLI validation provides concrete execution evidence alongside semantic analysis, while MCP remains read-only with no arbitrary command execution.

I redesigned the budgeted Markdown around a short summary, important changes and impact, likely improvements, regression risks, validation results, and relevant-file details. I expanded tests for Git behavior, AI boundaries and fallback, CLI/MCP consistency, structured output, rendering, and limits, and documented the interface and security model.

## What did you intentionally not do?

I intentionally did not expose arbitrary validation commands through MCP, give external models unrestricted repository access, or turn the tool into a generic AI code reviewer. Validation commands remain an explicit local CLI capability, AI receives only bounded changed evidence, and the model is used for semantic compression rather than authoritative correctness claims.

## Interface decision

Hybrid: the CLI is the primary interface for local developers, and MCP provides a typed interface for agents. Both use the same shared review core. The CLI can explicitly run bounded local validation, while MCP remains read-only and cannot execute arbitrary commands.

## How did you use an AI coding agent?

I used Codex to inspect the repository, implement the shared bounded review flow, add focused tests, exercise the built CLI and an MCP SDK client, and review the final diff and documentation. I verified trust boundaries and command outcomes directly.

## Where did you check, correct, or reject an AI suggestion? (required)

I rejected sending whole source files to OpenRouter and replaced it with bounded `git diff -U3` evidence. This reduces source exposure while preserving exact changed lines with minimal context.

## Commands used to verify the result, with outcomes

- `npm run typecheck` — exit 0; `npm test` — exit 0, 6 test files and 29 tests passed; `npm run build` — exit 0.
- `node dist/cli.js review --repo . --base-ref main --no-ai --max-output-tokens 1800` — passed, exit 0; generated deterministic Markdown.
- `node dist/cli.js review --repo . --base-ref main --no-ai --validate "npm run typecheck" --max-output-tokens 1800` — passed, exit 0; the report recorded both Git validation and CLI validation as passed.
- OpenRouter request — not run because `OPENROUTER_API_KEY` was absent; a clearly labeled representative report was generated through the production semantic renderer.
- MCP SDK client check — passed: one read-only tool, allowed-root rejection, separate server/client AI authorization, structured output, explicit improvement/risk sections, and byte-for-byte shared-core Markdown.

## A blocker you hit and how you approached it

The main blocker was making AI analysis useful without unnecessarily exposing source. `git diff -U3` provides compact changed hunks, but new and untracked files can still expose most of a file, so I added per-file and global limits, omission rules, and explicit truncation metadata.

## Known limitations and the next three things you would do

Semantic AI quality still needs validation on real repositories and models; bounded diffs may miss broader cross-file context; secret detection is heuristic, so AI should remain disabled under stricter source-data policies; and MCP is stdio/local rather than an authenticated remote service.

Next I would:

1. Run real OpenRouter reviews on representative repositories and evaluate the accuracy and usefulness of summaries, likely improvements, and regression risks.
2. Build authenticated cloud/remote agent endpoints with explicit tenant and source-egress controls.
3. Improve local context selection so the model gets the most relevant neighboring declarations and dependencies without simply sending more source.

## Approximate focused-work time

- Start: 2026-08-16 13:48 EDT
- Finish: 2026-08-16 15:06 EDT
- Total: about 1 hour 20 minutes
