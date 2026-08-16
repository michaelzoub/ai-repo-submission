# Repository Inspector

Repository Inspector performs bounded, read-only inspection of Git changes relative to a base ref. It has a hybrid interface:

- Developers and shell-capable agents can invoke the CLI.
- MCP-capable agents can invoke the same operation through a discoverable, typed tool.

Both adapters call the same review core, Git parser, limits, and renderers. Neither interface accepts shell commands, runs repository code, changes Git state, or writes a report file. The CLI emits Markdown or JSON on stdout; callers may decide whether to display, pipe, or persist it.

## What a review includes

The inspector resolves the merge base of the requested base ref and `HEAD`, then compares that commit with the current working state. This includes committed branch changes, staged changes, unstaged changes, renames, copies, and untracked (but not ignored) files. Paths are parsed from Git's NUL-delimited output, so spaces, tabs, and newlines are preserved.

At most 500 changed-file records are returned and the result says when it was truncated. Git subprocesses have a 30-second timeout and a 10 MiB output limit.

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
npm run inspector -- review --repo ./path/to/repo --format json
npm run inspector -- review --repo ./path/to/repo > review-report.md
```

Markdown is the default format. Output always goes to stdout. Use `--help` for all options. Exit status is `0` when inspection succeeds and `1` for an inspection or usage error.

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

It returns a one-line text summary plus the complete bounded result as structured output, avoiding a duplicate file list in model context. Its annotations declare it read-only, idempotent, non-destructive, and closed-world. These annotations describe the contract; they are not enforcement.

## Security model

“Read-only” means named, allowlisted inspection operations—not arbitrary user-supplied commands described as reads. Internally, the program invokes only fixed Git operations with separately passed arguments. It disables external diff drivers, text conversion, filesystem monitors, stdin, and Git's optional lock-taking side effects. Repository paths are canonicalized before allowed-root checks.

Allowed roots and MCP annotations are defense in depth, not an operating-system sandbox. For cloud or local agent use, run the process with OS-enforced read-only access to only the target checkout, no sensitive credentials, no production network access, and bounded CPU, memory, and process limits. The stdio server should run inside the agent's existing task sandbox; MCP itself does not create one.

## Why hybrid

MCP is an interoperability protocol, not a replacement for a shell interface or a security boundary. It adds typed discovery and structured invocation for compatible agent hosts. The CLI has fewer protocol/lifecycle dependencies, composes naturally with developer tooling, and is also usable by agents that already have a sandboxed shell. Keeping both as thin adapters avoids forcing either population through an unnatural interface.

The decision is supported by primary sources:

- The [MCP architecture specification](https://modelcontextprotocol.io/specification/2025-06-18/architecture) says servers may be local processes or remote services and assigns security enforcement to the host; it does not provide a sandbox.
- MCP's [security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) warns that local servers run code with client privileges and recommends sandboxing and minimal filesystem/network access.
- OpenAI documents sandboxing for [both local and cloud Codex](https://deploymentsafety.openai.com/gpt-5-2-codex/cybersecurity), while Anthropic documents an [isolated cloud sandbox for Claude Code](https://www.anthropic.com/engineering/claude-code-sandboxing). “Agent” therefore does not reliably imply cloud, and “MCP” does not imply isolation.
- Anthropic's analysis of [code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) shows that direct tool schemas and intermediate results can consume substantial context, while code-side filtering and progressive disclosure can reduce tokens and latency. A compact CLI/JSON path remains useful when an agent already has safe code execution.
- Git documents that [`GIT_OPTIONAL_LOCKS=0`](https://git-scm.com/docs/git) suppresses optional lock-taking side effects, and that [`--no-ext-diff` and `--no-textconv`](https://git-scm.com/docs/git-diff) prevent configured helper execution during diff inspection.

## Remaining limitations

- The default base is literally `main`; repositories using another default branch must pass `--base-ref`/`base_ref`.
- Reports contain repository paths and filenames. They do not perform secret redaction.
- The 500-file bound favors predictable output over completeness for very large changes; pagination and server-side filters are not implemented yet.
- This version reports changed-file metadata, not patches, findings, commit messages, submodule contents, or policy decisions.
