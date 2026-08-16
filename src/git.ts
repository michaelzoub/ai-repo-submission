import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import type { ChangedFile, DiffEvidence, FileEvidence, ValidationResult } from "./types.js";

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const PATCH_COMMAND_TIMEOUT_MS = 3_000;
const EVIDENCE_COLLECTION_TIMEOUT_MS = 12_000;
const VALIDATION_MAX_OUTPUT_BYTES = 16 * 1024;

export class InspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectionError";
  }
}

function git(repositoryPath: string, args: string[]): string {
  try {
    return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
      cwd: repositoryPath,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new InspectionError(`Git inspection failed: ${detail}`);
  }
}

function isWithin(candidate: string, root: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

export function resolveRepositoryPath(repositoryPath: string, allowedRoots?: string[]): string {
  let candidate: string;
  try {
    candidate = realpathSync(resolve(repositoryPath));
    if (!statSync(candidate).isDirectory()) {
      throw new InspectionError("Repository path is not a directory.");
    }
  } catch (error) {
    if (error instanceof InspectionError) throw error;
    throw new InspectionError(`Repository path does not exist or is not accessible: ${repositoryPath}`);
  }

  const topLevel = git(candidate, ["rev-parse", "--show-toplevel"]).trim();
  let repositoryRoot: string;
  try {
    repositoryRoot = realpathSync(topLevel);
  } catch {
    throw new InspectionError("Git returned an inaccessible repository root.");
  }

  if (allowedRoots !== undefined) {
    const roots = allowedRoots.map((root) => {
      try {
        return realpathSync(resolve(root));
      } catch {
        throw new InspectionError(`Configured allowed root is not accessible: ${root}`);
      }
    });
    if (!roots.some((root) => isWithin(repositoryRoot, root))) {
      throw new InspectionError("Repository is outside the server's allowed roots.");
    }
  }

  return repositoryRoot;
}

function validateBaseRef(repositoryPath: string, baseRef: string): string {
  if (!baseRef || baseRef.startsWith("-") || /[\0-\x1f\x7f]/.test(baseRef)) {
    throw new InspectionError("Base ref is invalid.");
  }
  try {
    git(repositoryPath, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
    return git(repositoryPath, ["merge-base", baseRef, "HEAD"]).trim();
  } catch {
    throw new InspectionError(`Base ref is not a commit reachable from HEAD: ${baseRef}`);
  }
}

function statusFor(code: string): ChangedFile["status"] {
  switch (code[0]) {
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    default: return "modified";
  }
}

function parseNameStatus(output: string): ChangedFile[] {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const files: ChangedFile[] = [];
  for (let index = 0; index < fields.length;) {
    const code = fields[index++];
    if (!code) throw new InspectionError("Git returned a malformed change status.");
    if (code.startsWith("R") || code.startsWith("C")) {
      const previousPath = fields[index++];
      const path = fields[index++];
      if (previousPath === undefined || path === undefined) {
        throw new InspectionError("Git returned a malformed rename or copy record.");
      }
      files.push({ path, previousPath, status: statusFor(code) });
    } else {
      const path = fields[index++];
      if (path === undefined) throw new InspectionError("Git returned a malformed change record.");
      files.push({ path, status: statusFor(code) });
    }
  }
  return files;
}

export type ChangeSet = {
  comparisonRef: string;
  files: ChangedFile[];
};

export function changedFiles(repositoryPath: string, baseRef = "main"): ChangeSet {
  const comparisonRef = validateBaseRef(repositoryPath, baseRef);
  const tracked = parseNameStatus(
    git(repositoryPath, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "-z",
      "--find-renames",
      "--find-copies",
      comparisonRef,
      "--",
    ]),
  );
  const knownPaths = new Set(tracked.map((file) => file.path));
  const untracked = git(repositoryPath, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .filter((path) => !knownPaths.has(path))
    .map((path): ChangedFile => ({ path, status: "untracked" }));

  return {
    comparisonRef,
    files: [...tracked, ...untracked].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

type EvidenceLimits = {
  maxFiles: number;
  maxPatchBytes: number;
  maxPatchBytesPerFile: number;
  maxPatchTokens?: number;
  maxPatchTokensPerFile?: number;
};

function boundedGit(
  repositoryPath: string,
  args: string[],
  maxBytes: number,
  timeout: number,
): { output: string; truncated: boolean; status: number | null; error?: Error } {
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd: repositoryPath,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    timeout,
    maxBuffer: maxBytes,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
  let output = stdout.subarray(0, maxBytes).toString("utf8");
  while (output.endsWith("\ufffd")) output = output.slice(0, -1);
  const error = result.error instanceof Error ? result.error : undefined;
  const truncated = Boolean(error && "code" in error && error.code === "ENOBUFS") || stdout.byteLength >= maxBytes;
  return { output, truncated, status: result.status, error };
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const encoded = Buffer.from(value);
  if (encoded.length <= maxBytes) return { value, truncated: false };
  let shortened = encoded.subarray(0, maxBytes).toString("utf8");
  if (shortened.endsWith("\ufffd")) shortened = shortened.slice(0, -1);
  const lastCompleteLine = shortened.lastIndexOf("\n");
  shortened = lastCompleteLine >= 0 ? shortened.slice(0, lastCompleteLine + 1) : "";
  return { value: shortened, truncated: true };
}

// UTF-8 bytes are a conservative token upper bound for the byte-level tokenizers
// used by supported downstream models. This intentionally favors disclosure safety.
function conservativeTokenUpperBound(value: string): number {
  return Buffer.byteLength(value);
}

function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);
  if ((name === ".env" || name.startsWith(".env.")) && !/\.(example|sample|template)$/.test(name)) return true;
  if ([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"].includes(extname(lower))) return true;
  return /^(id_(rsa|dsa|ecdsa|ed25519)|credentials\.json|service-account\.json)$/.test(name);
}

function containsPotentialSecret(patch: string): boolean {
  const sensitiveAssignment = /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|authorization)\s*[:=]/i;
  const credentialValue = /(?:sk-[a-z0-9_-]{16,}|gh[opurs]_[a-z0-9]{20,}|[a-f0-9]{40,}|[a-z0-9+/]{48,}={0,2})/i;
  return patch.split("\n").some((line) =>
    (sensitiveAssignment.test(line) || credentialValue.test(line) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line)),
  );
}

function filePriority(file: ChangedFile): number {
  const lower = file.path.toLowerCase();
  if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|.*\.min\.(js|css))$/.test(lower)) return 50;
  if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?)$/.test(lower)) return 45;
  if (/(^|\/)(package\.json|cargo\.toml|pyproject\.toml|go\.mod|dockerfile|.*config.*)$/.test(lower)) return 0;
  if (/(^|\/)(src|app|lib|server|packages)\//.test(lower)) return 5;
  if (/(^|\/)(test|tests|spec|__tests__)\//.test(lower) || /\.(test|spec)\./.test(lower)) return 15;
  if (/\.(md|txt|rst)$/.test(lower)) return 30;
  return 20;
}

function untrackedFileKind(repositoryPath: string, path: string): "text" | "binary" | "unsupported" | "read_error" {
  const candidate = resolve(repositoryPath, path);
  try {
    if (!isWithin(candidate, repositoryPath) || lstatSync(candidate).isSymbolicLink()) {
      return "unsupported";
    }
    const descriptor = openSync(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stats = fstatSync(descriptor);
      if (!stats.isFile()) return "unsupported";
      const buffer = Buffer.alloc(Math.min(8_192, stats.size));
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      return bytes.includes(0) ? "binary" : "text";
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return "read_error";
  }
}

function diffHunks(output: string): { patch: string; binary: boolean } {
  const binary = /(?:^|\n)(?:Binary files .* differ|GIT binary patch)(?:\n|$)/.test(output) || output.includes("\0");
  if (binary) return { patch: "", binary: true };
  const firstHunk = output.search(/^@@ /m);
  const patch = firstHunk >= 0 ? output.slice(firstHunk) : "";
  // Git may append a function/section label copied from outside the requested
  // context window. Retain only hunk coordinates so no extra source crosses the boundary.
  return {
    patch: patch.replace(/^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@).*$/gm, "$1"),
    binary: false,
  };
}

export function collectDiffEvidence(
  repositoryPath: string,
  comparisonRef: string,
  files: ChangedFile[],
  limits: EvidenceLimits,
): DiffEvidence {
  const deadline = Date.now() + EVIDENCE_COLLECTION_TIMEOUT_MS;
  const selected = [...files].sort((a, b) => filePriority(a) - filePriority(b) || a.path.localeCompare(b.path));
  const maxPatchTokens = limits.maxPatchTokens ?? limits.maxPatchBytes;
  const maxPatchTokensPerFile = limits.maxPatchTokensPerFile ?? limits.maxPatchBytesPerFile;
  const evidence: FileEvidence[] = [];
  let totalPatchBytes = 0;
  let totalPatchTokens = 0;
  let binaryFilesExcluded = 0;
  let sensitiveFilesExcluded = 0;
  let truncated = selected.length > limits.maxFiles;

  for (const file of selected.slice(0, limits.maxFiles)) {
    if (Date.now() >= deadline || totalPatchBytes >= limits.maxPatchBytes || totalPatchTokens >= maxPatchTokens) {
      truncated = true;
      continue;
    }
    if (isSensitivePath(file.path) || (file.previousPath && isSensitivePath(file.previousPath))) {
      sensitiveFilesExcluded++;
      continue;
    }

    const remaining = Math.min(
      limits.maxPatchBytes - totalPatchBytes,
      limits.maxPatchBytesPerFile,
      maxPatchTokens - totalPatchTokens,
      maxPatchTokensPerFile,
    );
    const commandLimit = Math.min(1024 * 1024, remaining + 8 * 1024);
    let result: ReturnType<typeof boundedGit>;
    if (file.status === "untracked") {
      const kind = untrackedFileKind(repositoryPath, file.path);
      if (kind === "binary") {
        binaryFilesExcluded++;
        continue;
      }
      if (kind !== "text") continue;
      const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
      result = boundedGit(
        repositoryPath,
        ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "-U3", "--", nullDevice, file.path],
        commandLimit,
        Math.max(1, Math.min(PATCH_COMMAND_TIMEOUT_MS, deadline - Date.now())),
      );
      if (result.status !== 1 && !result.truncated) {
        if (result.error) truncated = true;
        continue;
      }
    } else {
      result = boundedGit(
        repositoryPath,
        ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "-U3", "--find-renames", "--find-copies", comparisonRef, "--", file.path],
        commandLimit,
        Math.max(1, Math.min(PATCH_COMMAND_TIMEOUT_MS, deadline - Date.now())),
      );
      if (result.status !== 0 && !result.truncated) {
        if (result.error) truncated = true;
        continue;
      }
    }

    const extracted = diffHunks(result.output);
    if (extracted.binary) {
      binaryFilesExcluded++;
      continue;
    }
    if (!extracted.patch) {
      if (result.truncated) truncated = true;
      continue;
    }
    if (containsPotentialSecret(extracted.patch)) {
      sensitiveFilesExcluded++;
      continue;
    }
    const limited = truncateUtf8(extracted.patch, remaining);
    if (!limited.value) {
      truncated = true;
      continue;
    }
    const item: FileEvidence = {
      ...file,
      patch: limited.value,
      patchBytes: Buffer.byteLength(limited.value),
      patchTokens: conservativeTokenUpperBound(limited.value),
      patchTruncated: result.truncated || limited.truncated,
    };
    evidence.push(item);
    totalPatchBytes += item.patchBytes;
    totalPatchTokens += item.patchTokens;
    if (item.patchTruncated) truncated = true;
  }

  return {
    files: evidence,
    filesConsidered: Math.min(selected.length, limits.maxFiles),
    totalPatchBytes,
    totalPatchTokens,
    filesOmitted: files.length - evidence.length,
    binaryFilesExcluded,
    sensitiveFilesExcluded,
    limits: { ...limits, maxPatchTokens, maxPatchTokensPerFile },
    truncated,
  };
}

export function validateDiff(repositoryPath: string, comparisonRef: string): ValidationResult[] {
  const command = `git diff --check ${comparisonRef} --`;
  const result = boundedGit(
    repositoryPath,
    ["diff", "--no-ext-diff", "--no-textconv", "--check", comparisonRef, "--"],
    VALIDATION_MAX_OUTPUT_BYTES,
    10_000,
  );
  if (result.error && !result.truncated) {
    return [{ name: "Git diff check", command, status: "not_run", details: "The bounded Git validation command could not complete." }];
  }
  if (result.status === 0) {
    return [{ name: "Git diff check", command, status: "passed", details: "No whitespace errors were reported in tracked changes." }];
  }
  const details = "Git reported whitespace errors in tracked changes; offending source lines were omitted.";
  return [{
    name: "Git diff check",
    command,
    status: "failed",
    details: result.truncated ? `${details} Validation command output was truncated.` : details,
  }];
}
