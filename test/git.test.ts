import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changedFiles, resolveRepositoryPath } from "../src/git.js";
import { createGitFixture, git } from "./helpers.js";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("Git inspection", () => {
  it("includes renames and untracked files, preserving unusual paths", () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    git(repositoryPath, "mv", "old name.txt", "new name.txt");
    const unusualPath = "odd\tname\n.md";
    writeFileSync(join(repositoryPath, unusualPath), "new\n");

    const changes = changedFiles(repositoryPath, "main");

    expect(changes.comparisonRef).toMatch(/^[0-9a-f]{40}$/);
    expect(changes.files).toContainEqual({
      path: "new name.txt",
      previousPath: "old name.txt",
      status: "renamed",
    });
    expect(changes.files).toContainEqual({ path: unusualPath, status: "untracked" });
  });

  it("canonicalizes subdirectories and enforces allowed roots", () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    const subdirectory = join(repositoryPath, "nested");
    mkdirSync(subdirectory);

    expect(resolveRepositoryPath(subdirectory, [repositoryPath])).toBe(realpathSync(repositoryPath));
    expect(() => resolveRepositoryPath(repositoryPath, [join(repositoryPath, "nested")]))
      .toThrow("outside the server's allowed roots");
  });

  it("rejects option-like and missing base refs", () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    expect(() => changedFiles(repositoryPath, "--output=/tmp/oops")).toThrow("Base ref is invalid");
    expect(() => changedFiles(repositoryPath, "does-not-exist")).toThrow("Base ref is not a commit");
  });
});
