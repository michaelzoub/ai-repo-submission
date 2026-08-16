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

  if (allowedRoots?.length) {
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
    encoding: "utf8",
    timeout,
    maxBuffer: maxBytes,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = (result.stdout ?? "").slice(0, maxBytes);
  const error = result.error instanceof Error ? result.error : undefined;
  const truncated = Boolean(error && "code" in error && error.code === "ENOBUFS") || output.length >= maxBytes;
  return { output, truncated, status: result.status, error };
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const encoded = Buffer.from(value);
  if (encoded.length <= maxBytes) return { value, truncated: false };
  let shortened = encoded.subarray(0, maxBytes).toString("utf8");
  if (shortened.endsWith("\ufffd")) shortened = shortened.slice(0, -1);
  return { value: shortened, truncated: true };
}

function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);
  if ((name === ".env" || name.startsWith(".env.")) && !/\.(example|sample|template)$/.test(name)) return true;
  if ([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"].includes(extname(lower))) return true;
  return /^(id_(rsa|dsa|ecdsa|ed25519)|credentials\.json|service-account\.json)$/.test(name);
}

function redactPotentialSecrets(patch: string): string {
  const sensitiveAssignment = /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|authorization)\s*[:=]/i;
  const credentialValue = /(?:sk-[a-z0-9_-]{16,}|gh[opurs]_[a-z0-9]{20,}|[a-f0-9]{40,}|[a-z0-9+/]{48,}={0,2})/i;
  let inPrivateKey = false;
  return patch.split("\n").map((line) => {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line)) inPrivateKey = true;
    if (inPrivateKey) {
      const prefix = line.startsWith("+") || line.startsWith("-") ? line[0] : "";
      if (/-----END [A-Z ]*PRIVATE KEY-----/.test(line)) inPrivateKey = false;
      return `${prefix}[REDACTED: private key material]`;
    }
    if ((line.startsWith("+") || line.startsWith("-")) &&
        (sensitiveAssignment.test(line) || credentialValue.test(line))) {
      return `${line[0]}[REDACTED: potentially sensitive value]`;
    }
    return line;
  }).join("\n");
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

function untrackedPatch(repositoryPath: string, path: string, maxBytes: number): FileEvidence {
  const candidate = resolve(repositoryPath, path);
  try {
    if (!isWithin(candidate, repositoryPath) || lstatSync(candidate).isSymbolicLink()) {
      return { path, status: "untracked", patchBytes: 0, patchTruncated: false, binary: false, omittedReason: "unsupported_file" };
    }
    const descriptor = openSync(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stats = fstatSync(descriptor);
      if (!stats.isFile()) {
        return { path, status: "untracked", patchBytes: 0, patchTruncated: false, binary: false, omittedReason: "unsupported_file" };
      }
      const buffer = Buffer.alloc(Math.min(maxBytes + 1, stats.size));
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      if (bytes.subarray(0, 8_192).includes(0)) {
        return { path, status: "untracked", patchBytes: 0, patchTruncated: false, binary: true, omittedReason: "binary" };
      }
      const content = redactPotentialSecrets(bytes.toString("utf8"));
      const limited = truncateUtf8(`Untracked text file contents:\n${content}`, maxBytes);
      return {
        path,
        status: "untracked",
        patch: limited.value,
        patchBytes: Buffer.byteLength(limited.value),
        patchTruncated: limited.truncated || stats.size > maxBytes,
        binary: false,
      };
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return { path, status: "untracked", patchBytes: 0, patchTruncated: false, binary: false, omittedReason: "read_error" };
  }
}

export function collectDiffEvidence(
  repositoryPath: string,
  comparisonRef: string,
  files: ChangedFile[],
  limits: EvidenceLimits,
): DiffEvidence {
  const deadline = Date.now() + EVIDENCE_COLLECTION_TIMEOUT_MS;
  const selected = [...files].sort((a, b) => filePriority(a) - filePriority(b) || a.path.localeCompare(b.path));
  const evidence: FileEvidence[] = [];
  let totalPatchBytes = 0;
  let truncated = selected.length > limits.maxFiles;

  for (const file of selected.slice(0, limits.maxFiles)) {
    if (Date.now() >= deadline || totalPatchBytes >= limits.maxPatchBytes) {
      evidence.push({ ...file, patchBytes: 0, patchTruncated: false, binary: false, omittedReason: "budget" });
      truncated = true;
      continue;
    }
    if (isSensitivePath(file.path) || (file.previousPath && isSensitivePath(file.previousPath))) {
      evidence.push({ ...file, patchBytes: 0, patchTruncated: false, binary: false, omittedReason: "sensitive_path" });
      continue;
    }

    const remaining = Math.min(limits.maxPatchBytes - totalPatchBytes, limits.maxPatchBytesPerFile);
    let item: FileEvidence;
    if (file.status === "untracked") {
      item = { ...untrackedPatch(repositoryPath, file.path, remaining), ...file };
    } else {
      const result = boundedGit(
        repositoryPath,
        ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3", "--find-renames", "--find-copies", comparisonRef, "--", file.path],
        remaining,
        Math.max(1, Math.min(PATCH_COMMAND_TIMEOUT_MS, deadline - Date.now())),
      );
      if (result.status !== 0 && !result.truncated) {
        item = { ...file, patchBytes: 0, patchTruncated: false, binary: false, omittedReason: "read_error" };
      } else {
        const binary = /(?:^|\n)Binary files .* differ(?:\n|$)/.test(result.output);
        const redacted = binary ? "" : redactPotentialSecrets(result.output);
        const limited = truncateUtf8(redacted, remaining);
        item = {
          ...file,
          ...(limited.value ? { patch: limited.value } : {}),
          patchBytes: Buffer.byteLength(limited.value),
          patchTruncated: result.truncated || limited.truncated,
          binary,
          ...(binary ? { omittedReason: "binary" as const } : {}),
        };
      }
    }
    evidence.push(item);
    totalPatchBytes += item.patchBytes;
    if (item.patchTruncated || item.omittedReason === "budget") truncated = true;
  }

  return { files: evidence, filesConsidered: Math.min(selected.length, limits.maxFiles), totalPatchBytes, truncated };
}

function cleanCommandOutput(output: string): string {
  return output.replace(/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "?").replace(/\s+/g, " ").trim().slice(0, 500);
}

export function validateDiff(repositoryPath: string, comparisonRef: string): ValidationResult[] {
  const result = boundedGit(
    repositoryPath,
    ["diff", "--no-ext-diff", "--no-textconv", "--check", comparisonRef, "--"],
    VALIDATION_MAX_OUTPUT_BYTES,
    10_000,
  );
  if (result.error && !result.truncated) {
    return [{ name: "Git diff check", status: "not_run", details: "The bounded Git validation command could not complete." }];
  }
  if (result.status === 0) {
    return [{ name: "Git diff check", status: "passed", details: "No whitespace errors were reported in tracked changes." }];
  }
  const details = cleanCommandOutput(result.output) || "Git reported whitespace errors in tracked changes.";
  return [{ name: "Git diff check", status: "failed", details: result.truncated ? `${details} (output truncated)` : details }];
}
