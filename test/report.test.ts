import { describe, expect, it } from "vitest";
import { markdownReport } from "../src/report.js";

describe("markdownReport", () => {
  it("lists changed files", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      baseRef: "main",
      comparisonRef: "abc123",
      changedFiles: [{ path: "src/index.ts", status: "modified" }],
      totalChangedFiles: 1,
      changedFilesTruncated: false,
    });

    expect(report).toContain("**modified**: ` src/index.ts `");
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
});
