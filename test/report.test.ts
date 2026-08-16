import { describe, expect, it } from "vitest";
import { markdownReport } from "../src/report.js";

describe("markdownReport", () => {
  it("lists changed files and validation output", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      baseRef: "main",
      comparisonRef: "abc123",
      changedFiles: [{ path: "src/index.ts", status: "modified" }],
      totalChangedFiles: 1,
      changedFilesTruncated: false,
      validationResults: [{
        command: "npm test",
        status: "passed",
        exitCode: 0,
        output: "ok",
        outputTruncated: false,
      }],
    });

    expect(report).toContain("**modified**: ` src/index.ts `");
    expect(report).toContain("npm test");
    expect(report).toContain("ok");
  });

  it("keeps hostile filenames and output inside Markdown code delimiters", () => {
    const report = markdownReport({
      repositoryPath: "/work/<script>",
      baseRef: "main",
      comparisonRef: "abc123",
      changedFiles: [{ path: "` <img src=x>\nname", status: "added" }],
      totalChangedFiles: 1,
      changedFilesTruncated: false,
      validationResults: [{
        command: "printf fence",
        status: "passed",
        exitCode: 0,
        output: "```\nnot a closing fence",
        outputTruncated: false,
      }],
    });

    expect(report).toContain("`` ` <img src=x>\\nname ``");
    expect(report).toContain("````\n```\nnot a closing fence\n````");
  });
});
