import { describe, expect, it } from "vitest";
import { markdownReport, semanticMarkdownReport } from "../src/report.js";

describe("markdownReport", () => {
  it("uses the semantic report shape for deterministic changed-file facts", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      baseRef: "main",
      comparisonRef: "abc123",
      changedFiles: [{ path: "src/index.ts", status: "modified" }],
      totalChangedFiles: 1,
      changedFilesTruncated: false,
    });

    expect(report).toContain("## Summary");
    expect(report).toContain("## Important changes + impact");
    expect(report).toContain("- **modified file** — Git reports ` src/index.ts ` as modified.");
    expect(report).toContain("## Likely improvements");
    expect(report).toContain("*Not inferred: deterministic mode does not generate semantic improvement claims.*");
    expect(report).toContain("## Regression risks");
    expect(report).toContain("## Validation results");
    expect(report).toContain("## Per-file details");
  });

  it("keeps hostile filenames inside Markdown code delimiters", () => {
    const report = markdownReport({
      repositoryPath: "/work/<script>",
      baseRef: "main",
      comparisonRef: "abc123",
      changedFiles: [{ path: "` <img src=x>\nname", status: "added" }],
      totalChangedFiles: 1,
      changedFilesTruncated: false,
    });

    expect(report).toContain("`` ` <img src=x>\\nname ``");
  });

  it("uses the fixed semantic section template and empty states", () => {
    const { report } = semanticMarkdownReport({
      repositoryPath: "/work/sample",
      baseRef: "main",
      comparisonRef: "abc123",
      changedFiles: [],
      totalChangedFiles: 0,
      changedFilesTruncated: false,
      analysis: {
        summary: "No repository changes.",
        importantChanges: [],
        likelyImprovements: [],
        regressionRisks: [],
        fileDetails: [],
      },
      validation: [],
      evidence: {
        filesConsidered: 0,
        filesWithPatches: 0,
        totalPatchBytes: 0,
        totalPatchTokens: 0,
        filesOmitted: 0,
        binaryFilesExcluded: 0,
        sensitiveFilesExcluded: 0,
        truncated: false,
      },
    }, 512);

    expect(report).toBe(`# Repository Review

## Summary

No repository changes\\.

## Important changes + impact

*No important semantic changes identified.*

## Likely improvements

*No likely improvements identified from the bounded evidence.*

## Regression risks

*No specific regression risks identified from the bounded evidence.*

## Validation results

- **AI evidence:** 0 patch(es), 0 byte(s), 0 conservative token(s); truncated: no; 0 file(s) omitted, including 0 binary and 0 potentially sensitive file(s).

## Per-file details

*No additional file-level details.*
`);
  });
});
