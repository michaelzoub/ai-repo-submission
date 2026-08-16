import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function git(repositoryPath: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repositoryPath, encoding: "utf8" }).trim();
}

export function createGitFixture(): string {
  const repositoryPath = mkdtempSync(join(tmpdir(), "inspector repo-"));
  git(repositoryPath, "init", "-b", "main");
  git(repositoryPath, "config", "user.email", "inspector@example.test");
  git(repositoryPath, "config", "user.name", "Inspector Test");
  writeFileSync(join(repositoryPath, "old name.txt"), "original\n");
  git(repositoryPath, "add", ".");
  git(repositoryPath, "commit", "-m", "base");
  git(repositoryPath, "switch", "-c", "feature");
  return repositoryPath;
}
