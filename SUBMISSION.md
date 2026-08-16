# Submission

## What did you investigate first, and why?

I read every source file, the public test, package/build configuration, and submission instructions, then ran install, typecheck, and tests before changing code. I exercised both advertised interfaces against a temporary Git repository whose path contained spaces and included a rename and an untracked file. I used a real MCP SDK client over stdio, listed the tool schema, and called it.

That baseline exposed the most serious contract defect: MCP required `repo_path` but the handler read `repoPath`, so it silently inspected the server's current directory and returned `# Review Report: undefined`. I next prioritized arbitrary MCP shell execution, repository-path confinement, Git/ref parsing, failure behavior, output bounds, and interface parity because those are material trust-boundary issues for a payments company.

## What did you choose to implement or fix?

- Fixed MCP's input contract, converted all fields to consistent snake_case, removed `any`, added structured output/output schema, read-only annotations, actionable errors, and an actual client/server contract test.
- Made MCP review-only. It no longer advertises or accepts validation commands. Canonical allowed roots default to the server's current directory and can be configured with `INSPECTOR_ALLOWED_ROOTS`; symlink and subdirectory resolution is checked against canonical paths.
- Kept validation in the explicit local CLI capability. Failures and timeouts now become report results instead of losing the whole review; CLI returns status 2 after writing such a report. Added per-command timeouts and 64 KiB output bounds.
- Fixed CLI paths containing spaces, rejected missing/unknown/invalid arguments, implemented real JSON output, added `--output`/stdout support, documented exit statuses, and made error messages concise.
- Changed Git inspection to cover the merge-base-to-working-state view: committed, staged, unstaged, rename/copy, and untracked changes. NUL-delimited parsing preserves unusual filenames. Refs starting with options/control characters are rejected and verified as commits.
- Added Git subprocess time/output bounds and disabled repository-configured external diffs, text conversion, and filesystem-monitor commands.
- Made Markdown hostile-name/fence-safe and bounded changed-file results at 500 with explicit truncation metadata.
- Split production build configuration from test typechecking. The starter emitted tests into `dist`; the new build emits seven runtime files and its declared CLI binary exists.
- Expanded verification from one assertion to 10 tests across five suites, plus separate end-to-end CLI and stdio MCP smoke tests.

## What did you intentionally not do?

I did not add patch contents or LLM-generated findings: both substantially enlarge the sensitive-data and output-size surface and need a separate product contract. I did not add MCP validation behind an environment flag because that still makes every connected client a shell principal once enabled. I did not invent secret redaction, since regex-based masking would create false assurance for payment data. I also did not add HTTP MCP transport/authentication, automatic remote fetching, dependency installation, or repository mutation.

## Interface decision

- Decision: **Hybrid**, with asymmetric capabilities.
- Primary user and execution environment: Local developers use CLI for review plus trusted validations. Cloud coding agents use a per-task stdio MCP server inside a disposable, least-privileged sandbox containing only the target checkout.
- Trust boundary and allowed capabilities: Both interfaces may read Git metadata and filenames. CLI validation is explicit arbitrary local shell execution under the invoking developer's identity. MCP is read-only, constrained to operator-configured canonical roots, and has no validation field. In a payments deployment the container—not the root string—is the hard boundary; it should have no payment credentials or production network access.
- Reliability, discoverability, latency/context, and output tradeoffs: CLI is universally scriptable, debuggable, and has natural files/exit codes, but a cloud agent needs a shell sandbox and must learn flags/output paths. MCP provides schema discovery, annotations, structured content, and no shell-quoting round trip, so agents spend less context and latency parsing help or Markdown. Its extra SDK/protocol/process lifecycle is another failure surface. Both cap changed files; MCP returns structured data plus compact text, while CLI can persist full Markdown or JSON without consuming model context.
- How supported interfaces remain consistent: A shared core owns canonicalization, base semantics, Git parsing, limits, validation result types, and renderers. Tests exercise core behavior and MCP's real schema/call path. The intentional capability difference is explicit: validation exists only in CLI; repository review semantics are the same.
- Evidence that would change this decision: I would move MCP-first if most usage were authenticated remote agents, sandbox/root enforcement were platform-provided and audited, telemetry showed schema/context savings materially improved completion, and developers rarely used shell pipelines. I would move CLI-first if MCP usage were negligible, clients could reliably invoke the binary in sandboxes, or maintaining protocol compatibility caused disproportionate incidents. Safe demand for remote validation would require a fixed server-side command allowlist or job API—not raw client commands.

## How did you use an AI coding agent?

I used the agent to inventory the repository, form and reprioritize a threat model, create controlled Git fixtures, drive a real MCP client, implement the shared/adaptor changes, expand tests, inspect diffs, and run verification after each meaningful change. I treated tool output and tests as evidence rather than accepting generated code or claims directly, and made an intermediate implementation commit before this final documentation commit.

## Where did you check, correct, or reject an AI suggestion? (required)

I rejected the initial suggestion to retain MCP validation behind `INSPECTOR_ALLOW_VALIDATION=1`. An environment switch changes when the vulnerability is active, not the capability: once enabled, any connected agent can supply arbitrary shell. I removed the field from MCP entirely and kept it in the explicit local CLI boundary.

I also corrected a generated integration-test expectation rather than weakening production code. On macOS, `realpath` canonicalized `/var/...` to `/private/var/...`; the test initially expected the noncanonical fixture string. Canonicalization is necessary to prevent symlink/root-boundary bypass, so I updated the test to compare canonical paths. Finally, a clean build revealed tests were being emitted into `dist` and then executed twice; I added a dedicated build config and reverified the artifact layout.

## Commands used to verify the result, with outcomes

- `npm install --cache /private/tmp/repository-inspector-npm-cache` — succeeded; npm reported five transitive audit findings (2 moderate, 3 high). The initial plain `npm install` hit an npm exit-handler/cache-log sandbox issue, so I used a writable cache and left the lockfile unchanged.
- `npm run typecheck` — passed.
- `npm test` — 5 files, 10 tests passed. Coverage includes spaces/control characters in paths, renames/untracked files, bad refs, canonical allowed roots, CLI parsing, validation failure/timeout/output bounds, Markdown fences, and MCP schema/results/denial.
- `npm run build` — passed; clean `dist` contains only `cli.js`, `core.js`, `git.js`, `mcp-server.js`, `report.js`, `types.js`, and `validation.js`.
- `npm run inspector -- review --repo "/private/tmp/repo inspector..." --base-ref main --format json --output /private/tmp/inspector-cli.json --validate "node -e ..."` — exit 0; JSON named the canonical spaced path, rename origin, added file, comparison SHA, and passing validation.
- Built-server stdio MCP client (`listTools` then `callTool`) — passed; schema exposed only `repo_path`/`base_ref`, output schema and read-only annotations were present, and structured/text results agreed.
- `git diff --check` — passed.

## A blocker you hit and how you approached it

The managed sandbox denied `tsx`'s local IPC socket, so the documented `npm run inspector` could not execute in the default test shell. I first built and called the plain Node artifacts where possible, then used the narrowly approved command for the exact documented CLI smoke test. Separately, npm could not write its default cache logs; a task-specific cache under `/private/tmp` made installation reproducible without broadening filesystem permissions.

## Known limitations and the next three things you would do

Known limitations are documented in README: no patch/finding inspection, literal `main` default, no redaction, and platform-dependent descendant cleanup for CLI validation. The current package audit also needs dependency ownership review before production.

Next:

1. Add a separate, byte-limited patch/finding API with path allow/deny policy and deterministic secret scanning before any model sees content.
2. Replace local CLI validation execution in cloud workflows with named, server-side allowlisted jobs inside an OS sandbox, with process-group cancellation and CPU/memory/network limits.
3. Add CI across macOS/Linux/Windows and adversarial repositories (large index, submodules, shallow/unrelated histories, hostile config/attributes), plus dependency audit/SBOM/signing and MCP compatibility tests.

## Approximate focused-work time

- Start: 2026-08-16 13:49 America/Montreal
- Finish: 2026-08-16 14:04 America/Montreal
- Approximate focused time: 15 minutes
