# Repository Inspector

Repository Inspector performs bounded, read-only inspection of Git changes relative to a base ref. It is CLI-first, with MCP as a thin adapter:

- Developers and shell-capable agents can invoke the CLI.
- MCP-capable agents can invoke the same shared review operation through a discoverable, typed tool.

Both adapters call the same review orchestration, Git parser, limits, optional AI analyzer, validation, and renderers. Neither interface accepts shell commands, runs repository code, changes Git state, or writes a report file. The CLI emits Markdown or JSON on stdout; callers may decide whether to display, pipe, or persist it.

## What a review includes

The inspector resolves the merge base of the requested base ref and `HEAD`, then compares that commit with the current working state. This includes committed branch changes, staged changes, unstaged changes, renames, copies, and untracked (but not ignored) files. Paths are parsed from Git's NUL-delimited output, so spaces, tabs, and newlines are preserved.

When AI is configured, the report contains a short semantic summary, important changes and their impact, Git validation results, and concise details for relevant files. The model receives bounded patch evidence and returns structured data; application code validates that data and renders deterministic Markdown. AI failures, malformed responses, and disabled or missing AI configuration fall back to the existing deterministic `markdownReport()`.

At most 500 changed-file records are returned. Patch evidence is prioritized and bounded to 40 files, 16 KiB per file, and 96 KiB total by default. Git subprocesses and provider requests have timeouts and output limits. The Markdown report defaults to a strict 1,800-token budget; lower-priority file details are omitted first.

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
npm run inspector -- review --repo ./path/to/repo --no-ai
npm run inspector -- review --repo ./path/to/repo --format json
npm run inspector -- review --repo ./path/to/repo > review-report.md
```

Markdown is the default format. Output always goes to stdout. Use `--help` for all options. Exit status is `0` when inspection succeeds, including when AI falls back, and `1` for an inspection or usage error.

OpenRouter analysis is enabled when `OPENROUTER_API_KEY` is present. `OPENROUTER_MODEL` selects the model and defaults to `openai/gpt-4.1-mini`; `OPENROUTER_BASE_URL` overrides the HTTPS API base; `INSPECTOR_AI_TIMEOUT_MS` controls the bounded request timeout; and `INSPECTOR_AI_ENABLED=false` disables AI globally. The `ChangeAnalyzer` interface is provider-neutral, so another implementation can be injected without changing core review behavior.

The CLI exposes named review options, not a generic command runner. Redirection in the last example is performed by the caller's shell and is outside the inspector's capability boundary.

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
- `max_output_tokens` (optional): Markdown budget between 256 and the server limit.
- `ai` (optional): whether to use configured AI analysis.

It returns the same budgeted Markdown as the CLI plus the bounded result as structured output. Its annotations declare it read-only, idempotent, non-destructive, and closed-world. These annotations describe the contract; they are not enforcement.

## Security model

“Read-only” means named, allowlisted inspection operations—not arbitrary user-supplied commands described as reads. Internally, the program invokes only fixed Git operations with separately passed arguments. It disables external diff drivers, text conversion, filesystem monitors, stdin, and Git's optional lock-taking side effects. Repository paths are canonicalized before allowed-root checks.

Patch and command output, collection time, provider request/response size, provider time, and rendered output are bounded. Binary files, untracked symlinks, and likely credential files are excluded from AI content. Likely secret-bearing changed lines are redacted. Repository paths are not sent to the provider. Filenames, patches, and provider output remain untrusted data; AI output must match a strict schema, may reference only known files, and is escaped by the deterministic renderer.

These filters are safeguards, not a complete secret scanner. Use `--no-ai` when repository policy prohibits sending source to an external provider.

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
- Validation is limited to `git diff --check`; the inspector does not run builds, tests, hooks, or arbitrary commands.
- Semantic coverage is bounded and may omit low-priority files; the result reports evidence coverage and truncation.
- Secret filtering is heuristic. Disable external AI when stronger data-boundary guarantees are required.
