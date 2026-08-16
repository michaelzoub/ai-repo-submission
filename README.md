# Repository Inspector

Repository Inspector performs bounded, read-only inspection of Git changes relative to a base ref. It is CLI-first, with MCP as a thin adapter:

- Developers and shell-capable agents can invoke the CLI.
- MCP-capable agents can invoke the same shared review operation through a discoverable, typed tool.

Both adapters call the same review orchestration, Git parser, limits, optional AI analyzer, Git validation, and renderers. The local CLI can additionally run one explicitly supplied, bounded `--validate` shell command; MCP exposes no command-execution path. The review core does not change Git state or write a report file, although a caller-authorized validation command runs with the caller's privileges. The CLI emits Markdown or JSON on stdout; callers may decide whether to display, pipe, or persist it.

## What a review includes

The inspector resolves the merge base of the requested base ref and `HEAD`, then compares that commit with the current working state. This includes committed branch changes, staged changes, unstaged changes, renames, copies, and untracked (but not ignored) files. Paths are parsed from Git's NUL-delimited output, so spaces, tabs, and newlines are preserved.

When AI is explicitly enabled and configured, the report contains a short semantic summary, important changes ordered by significance, explicit likely improvements, explicit regression risks, local validation results, and concise details for relevant files. Likely improvements and regression risks are separate required arrays in the provider JSON contract and separate Markdown sections. Application code validates every field and file reference, then renders Markdown deterministically. AI failures, timeouts, malformed responses, and disabled or missing AI configuration fall back cleanly to the deterministic report.

At most 500 changed-file records are returned. AI evidence is prioritized and bounded by both bytes and a deliberately conservative token upper bound. Defaults are 40 files, 16 KiB and 4,000 conservative tokens per file, and 96 KiB and 24,000 conservative tokens globally. Since the token upper bound counts each UTF-8 byte as a possible token, the token cap is intentionally cautious across downstream model tokenizers. Git subprocesses and provider requests also have timeouts and output limits. The Markdown report defaults to an approximate 1,800-output-token budget implemented through a character bound; lower-priority file details are omitted first.

### External-model trust boundary

Only bounded changed hunks produced by `git diff -U3` are eligible for external source analysis. For untracked files, the equivalent local command is `git diff --no-index -U3 -- /dev/null <path>`. The inspector retains hunk coordinates plus added, removed, and three surrounding context lines; it strips diff headers and Git's optional out-of-window function label. Existing files are not sent as whole-source snapshots. A new file is represented almost entirely as additions, so it may still expose much of its contents before the per-file and global byte/token limits apply. Partial final lines are dropped instead of forwarding fragments.

The OpenRouter request contains included file paths/statuses, bounded hunks, per-file/global size and truncation metadata, and validation names/statuses. Validation commands and their output stay local because a validation command could print source. Binary files are absent entirely. Likely credential files and patches containing likely credentials are also omitted rather than rewritten, preserving the exact lines of every hunk that is sent. The request contains no repository path, arbitrary file-reading or command tool, or mechanism for the model to request more source or execute repository code. Evidence truncation and omission counts are recorded in the provider payload and in CLI JSON/MCP structured output.

## Setup and verification

Requires Node.js 20 or newer and Git.

```bash
npm install
npm run typecheck
npm test
npm run build
```

The production build writes runtime files only to `dist/`; the executable is `dist/cli.js`.

## CLI

```bash
npm run inspector -- review --repo ./path/to/repo
npm run inspector -- review --repo ./path/to/repo --base-ref origin/main
npm run inspector -- review --repo ./path/to/repo --max-output-tokens 1200
npm run inspector -- review --repo ./path/to/repo --ai
npm run inspector -- review --repo ./path/to/repo --validate "npm test"
npm run inspector -- review --repo ./path/to/repo --no-ai
npm run inspector -- review --repo ./path/to/repo --format json
npm run inspector -- review --repo ./path/to/repo > review-report.md
```

Markdown is the default format. Output always goes to stdout. Use `--help` for all options. Exit status is `0` when inspection and validation succeed, `2` when the review completes but any validation fails, and `1` for an inspection or usage error. AI fallback alone does not make the command fail.

External AI is opt-in. The CLI requires either `--ai` or `INSPECTOR_AI_ENABLED=true`; `--no-ai` overrides the environment. `OPENROUTER_API_KEY` supplies credentials but does not authorize source-code egress by itself. `OPENROUTER_MODEL` selects the model and defaults to `openai/gpt-4.1-mini`; `OPENROUTER_BASE_URL` overrides the HTTPS API base; and `INSPECTOR_AI_TIMEOUT_MS` controls the bounded request timeout. The `ChangeAnalyzer` interface is provider-neutral, so another implementation can be injected without changing core review behavior.

`--validate` is local-CLI-only and executes one caller-supplied shell command in the canonical repository root. It has a 60-second timeout, ignores stdin, and captures at most 16 KiB of combined stdout/stderr for the local report. The external AI receives only the validation name and pass/fail status, never the command or output. Redirection in the last example is performed by the caller's shell and is outside the inspector's capability boundary.

## MCP

Start the stdio server from the directory containing repositories the client may inspect:

```bash
npm run mcp-server
```

By default, the canonical current directory is the only allowed root. To configure multiple roots, use the platform path delimiter (`:` on macOS/Linux, `;` on Windows):

```bash
INSPECTOR_ALLOWED_ROOTS="/workspace/repo-a:/workspace/repo-b" npm run mcp-server
```

The `review_repository` tool accepts:

- `repo_path` (required): repository or subdirectory inside an allowed root.
- `base_ref` (optional): base commit or branch; defaults to `main`.
- `max_output_tokens` (optional): approximate Markdown output-token budget between 256 and the server limit.
- `ai` (optional): requests external AI. It is effective only when the server/operator also started the server with `INSPECTOR_AI_ENABLED=true`; a client cannot override disabled server policy.

It returns the same shared-core, budgeted Markdown as the CLI plus the bounded result as structured output. There is deliberately no validation-command input. Its annotations declare it read-only, idempotent, non-destructive, and closed-world. These annotations describe the contract; they are not enforcement.

## Security model

For MCP, “read-only” means named, allowlisted inspection operations—not arbitrary user-supplied commands described as reads. Its path invokes only fixed Git operations with separately passed arguments. Those operations disable external diff drivers, text conversion, filesystem monitors, stdin, and Git's optional lock-taking side effects. Repository paths are canonicalized before allowed-root checks. The CLI's explicitly requested `--validate` command is a separate local trust decision and is never exposed to OpenRouter.

Patch and command output, collection time, provider request/response size, provider time, and rendered output are bounded. Binary files, untracked symlinks, likely credential files, and patches with likely credential material are excluded from AI content. Repository paths are not sent to the provider. Filenames, patches, validation results, and provider output remain untrusted data; AI output must match a strict schema, may reference only files whose hunks were supplied, and is escaped by the deterministic renderer.

These filters are safeguards, not a complete secret scanner. Leave AI disabled when repository policy prohibits sending source to an external provider.

Allowed roots and MCP annotations are defense in depth, not an operating-system sandbox. For cloud or local agent use, run the process with OS-enforced read-only access to only the target checkout, no unrelated credentials, and bounded CPU, memory, process, and network privileges. The stdio server should run inside the agent's existing task sandbox; MCP itself does not create one.

## Why hybrid

The product surface remains hybrid, but the architecture is CLI-first: the CLI is the primary developer interface and MCP adapts the same core result without a separate review path. MCP adds typed discovery for compatible agent hosts; it is not a replacement for a shell interface or a security boundary.

The decision is supported by primary sources:

- The [MCP architecture specification](https://modelcontextprotocol.io/specification/2025-06-18/architecture) says servers may be local processes or remote services and assigns security enforcement to the host; it does not provide a sandbox.
- MCP's [security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) warns that local servers run code with client privileges and recommends sandboxing and minimal filesystem/network access.
- OpenAI documents sandboxing for [both local and cloud Codex](https://deploymentsafety.openai.com/gpt-5-2-codex/cybersecurity), while Anthropic documents an [isolated cloud sandbox for Claude Code](https://www.anthropic.com/engineering/claude-code-sandboxing). “Agent” therefore does not reliably imply cloud, and “MCP” does not imply isolation.
- Anthropic's analysis of [code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) shows that direct tool schemas and intermediate results can consume substantial context, while code-side filtering and progressive disclosure can reduce tokens and latency. A compact CLI/JSON path remains useful when an agent already has safe code execution.
- Git documents that [`GIT_OPTIONAL_LOCKS=0`](https://git-scm.com/docs/git) suppresses optional lock-taking side effects, and that [`--no-ext-diff` and `--no-textconv`](https://git-scm.com/docs/git-diff) prevent configured helper execution during diff inspection.

## Remaining limitations

- The default base is literally `main`; repositories using another default branch must pass `--base-ref`/`base_ref`.
- MCP validation is limited to the fixed local `git diff --check`. The local CLI can run one bounded arbitrary `--validate` command with the caller's privileges; it is not an OS sandbox.
- Semantic coverage is bounded and may omit low-priority, binary, sensitive, unsupported, or unreadable files; the result reports evidence coverage, omissions, and truncation.
- Secret filtering is heuristic. Disable external AI when stronger data-boundary guarantees are required.
