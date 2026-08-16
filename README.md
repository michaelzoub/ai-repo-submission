# Repository Inspector

Repository Inspector reviews Git changes relative to a base ref, optionally runs trusted validation commands, and emits a bounded Markdown or JSON report. It has a hybrid interface:

- The CLI is the full local-developer interface, including explicit validation execution.
- The MCP server is a read-only, root-constrained interface for sandboxed coding agents. It cannot run validation commands.

Both adapters use the same review orchestration, Git parser, limits, and Markdown renderer.

## What a review includes

The inspector resolves the merge base of the requested base ref and `HEAD`, then compares that commit with the current working state. This includes committed branch changes, staged changes, unstaged changes, renames, copies, and untracked (but not ignored) files. Paths are parsed from Git's NUL-delimited output, so spaces, tabs, and newlines are preserved.

At most 500 changed-file records are returned. The report says when this limit is reached. Git subprocesses have a 30-second timeout and a 10 MiB output limit.

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
npm run inspector -- review --repo ./path/to/repo --format json --output review.json
npm run inspector -- review --repo ./path/to/repo --validate "npm test"
npm run inspector -- review --repo ./path/to/repo --output -
```

Markdown defaults to `review-report.md`; JSON defaults to `review-report.json`. Use `--help` for all options. Exit status is `0` when inspection and validations pass, `1` for an inspection or usage error, and `2` when a report was written but a validation failed or timed out.

`--validate` invokes a shell command with the current user's privileges in the repository. It is not a safe way to run untrusted repository code. Use it only for commands you trust, preferably in a disposable sandbox. Each command defaults to a 120-second timeout (configurable up to ten minutes), and captured output is limited to 64 KiB.

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

It returns both a compact Markdown text block and structured output. Its annotations declare it read-only, idempotent, non-destructive, and closed-world. Validation is deliberately absent from the schema: making client-supplied shell commands available to a remote agent would cross the server's trust boundary.

Allowed roots are defense in depth, not an operating-system sandbox. In a payments environment, run one stdio server per task in a least-privileged container with only the target checkout mounted, no payment credentials, no production network access, and bounded CPU/memory/process limits. The Git calls disable external diffs, text conversion, and filesystem-monitor commands, but the process boundary remains the primary control.

## Remaining limitations

- The default base is literally `main`; repositories using another default branch must pass `--base-ref`/`base_ref`.
- Reports contain repository paths, filenames, command strings, and validation output. They do not perform secret redaction.
- Validation timeout terminates the shell process, but complete descendant-process cleanup is platform-dependent; use container-level time and process limits.
- This version reports changed-file metadata, not patches, findings, commit messages, submodule contents, or policy decisions.
