import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { ChangedFile } from "./types.js";

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

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
