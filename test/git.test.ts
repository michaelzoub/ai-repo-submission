import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changedFiles, collectDiffEvidence, resolveRepositoryPath, validateDiff } from "../src/git.js";
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

  it("collects bounded patches while excluding binary and sensitive files", () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "old name.txt"), `password = "super-secret-value"\n${"change\n".repeat(500)}`);
    writeFileSync(join(repositoryPath, ".env"), "API_KEY=must-not-leave\n");
    writeFileSync(join(repositoryPath, "image.bin"), Buffer.from([0, 1, 2, 3]));
    const changes = changedFiles(repositoryPath, "main");

    const evidence = collectDiffEvidence(repositoryPath, changes.comparisonRef, changes.files, {
      maxFiles: 10,
      maxPatchBytes: 2_000,
      maxPatchBytesPerFile: 1_000,
    });

    expect(evidence.totalPatchBytes).toBeLessThanOrEqual(2_000);
    expect(evidence.files.find((file) => file.path === ".env")?.omittedReason).toBe("sensitive_path");
    expect(evidence.files.find((file) => file.path === "image.bin")).toMatchObject({ binary: true, omittedReason: "binary" });
    const textPatch = evidence.files.find((file) => file.path === "old name.txt");
    expect(textPatch?.patch).toContain("[REDACTED: potentially sensitive value]");
    expect(textPatch?.patch).not.toContain("super-secret-value");
    expect(textPatch?.patchTruncated).toBe(true);
  });

  it("reports Git whitespace validation without running repository code", () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "old name.txt"), "trailing whitespace   \n");
    const changes = changedFiles(repositoryPath, "main");
    expect(validateDiff(repositoryPath, changes.comparisonRef)).toEqual([
      expect.objectContaining({ name: "Git diff check", status: "failed" }),
    ]);
  });
});
