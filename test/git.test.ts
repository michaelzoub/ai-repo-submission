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

  it("collects only bounded git diff -U3 hunks and excludes binary and sensitive files", () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "old name.txt"), Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n") + "\n");
    git(repositoryPath, "add", "old name.txt");
    git(repositoryPath, "commit", "-m", "expand fixture");
    writeFileSync(join(repositoryPath, "old name.txt"), Array.from({ length: 12 }, (_, index) => index === 5 ? "updated line 6" : `line ${index + 1}`).join("\n") + "\n");
    writeFileSync(join(repositoryPath, ".env"), "API_KEY=must-not-leave\n");
    writeFileSync(join(repositoryPath, "image.bin"), Buffer.from([0, 1, 2, 3]));
    const changes = changedFiles(repositoryPath, "HEAD");

    const evidence = collectDiffEvidence(repositoryPath, changes.comparisonRef, changes.files, {
      maxFiles: 10,
      maxPatchBytes: 2_000,
      maxPatchBytesPerFile: 1_000,
      maxPatchTokens: 2_000,
      maxPatchTokensPerFile: 1_000,
    });

    expect(evidence.totalPatchBytes).toBeLessThanOrEqual(2_000);
    expect(evidence.totalPatchTokens).toBeLessThanOrEqual(2_000);
    expect(evidence.files.map((file) => file.path)).not.toContain(".env");
    expect(evidence.files.map((file) => file.path)).not.toContain("image.bin");
    expect(evidence.binaryFilesExcluded).toBe(1);
    expect(evidence.sensitiveFilesExcluded).toBe(1);
    const textPatch = evidence.files.find((file) => file.path === "old name.txt");
    expect(textPatch?.patch).toMatch(/^@@ -3,7 \+3,7 @@/);
    expect(textPatch?.patch).toContain("-line 6\n+updated line 6");
    expect(textPatch?.patch).not.toContain("diff --git");
    expect(textPatch?.patch).not.toContain("line 2\n");
    expect(textPatch?.patch).not.toContain("line 10\n");
    expect(textPatch?.patchTruncated).toBe(false);
  });

  it("uses git diff hunks for new files and records per-file and global truncation", () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "large-new.txt"), "new content\n".repeat(1_000));
    writeFileSync(join(repositoryPath, "second-new.txt"), "second\n".repeat(100));
    const changes = changedFiles(repositoryPath, "main");

    const evidence = collectDiffEvidence(repositoryPath, changes.comparisonRef, changes.files, {
      maxFiles: 1,
      maxPatchBytes: 220,
      maxPatchBytesPerFile: 140,
      maxPatchTokens: 180,
      maxPatchTokensPerFile: 120,
    });

    expect(evidence.totalPatchBytes).toBeLessThanOrEqual(180);
    expect(evidence.totalPatchTokens).toBeLessThanOrEqual(180);
    expect(evidence.truncated).toBe(true);
    expect(evidence.filesOmitted).toBeGreaterThan(0);
    expect(evidence.files[0]).toMatchObject({ status: "untracked", patchTruncated: true });
    expect(evidence.files[0].patch).toMatch(/^@@ -0,0 \+1,1000 @@/);
    expect(evidence.files[0].patch).not.toContain("Untracked text file contents");
    expect(evidence.files[0].patchBytes).toBeLessThanOrEqual(140);
    expect(evidence.files[0].patchTokens).toBeLessThanOrEqual(120);
  });

  it("omits evidence when a likely secret appears only in hunk context", () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "old name.txt"), "line 1\nAPI_KEY=secret-in-context\nline 3\nline 4\nline 5\n");
    git(repositoryPath, "add", "old name.txt");
    git(repositoryPath, "commit", "-m", "add context fixture");
    writeFileSync(join(repositoryPath, "old name.txt"), "line 1\nAPI_KEY=secret-in-context\nline 3 updated\nline 4\nline 5\n");
    const changes = changedFiles(repositoryPath, "HEAD");

    const evidence = collectDiffEvidence(repositoryPath, changes.comparisonRef, changes.files, {
      maxFiles: 10,
      maxPatchBytes: 2_000,
      maxPatchBytesPerFile: 1_000,
      maxPatchTokens: 2_000,
      maxPatchTokensPerFile: 1_000,
    });

    expect(evidence.files).toEqual([]);
    expect(evidence.sensitiveFilesExcluded).toBe(1);
  });

  it("reports Git whitespace validation without running repository code", () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "old name.txt"), "source-must-not-be-forwarded   \n");
    const changes = changedFiles(repositoryPath, "main");
    const validation = validateDiff(repositoryPath, changes.comparisonRef);
    expect(validation).toEqual([
      expect.objectContaining({ name: "Git diff check", command: expect.stringContaining("git diff --check"), status: "failed" }),
    ]);
    expect(validation[0].details).not.toContain("source-must-not-be-forwarded");
  });
});
