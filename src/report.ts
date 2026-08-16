import type { ReviewResult } from "./types.js";

function printable(value: string): string {
  return value.replace(/[\0-\x1f\x7f]/g, (character) =>
    JSON.stringify(character).slice(1, -1),
  );
}

function inlineCode(value: string): string {
  const safe = printable(value);
  const longestRun = Math.max(0, ...[...safe.matchAll(/`+/g)].map((match) => match[0].length));
  const delimiter = "`".repeat(longestRun + 1);
  return `${delimiter} ${safe} ${delimiter}`;
}

function codeBlock(output: string): string[] {
  if (!output) return ["_No output._"];
  const longestRun = Math.max(2, ...[...output.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  return [fence, output, fence];
}

export function markdownReport(input: ReviewResult): string {
  const lines = [
    "# Repository Review",
    "",
    `- Repository: ${inlineCode(input.repositoryPath)}`,
    `- Base ref: ${inlineCode(input.baseRef)}`,
    `- Comparison commit: ${inlineCode(input.comparisonRef)}`,
    "",
    `## Changed files (${input.changedFiles.length} shown of ${input.totalChangedFiles})`,
  ];

  if (!input.changedFiles.length) lines.push("", "_No changed files._");
  for (const file of input.changedFiles) {
    const previous = file.previousPath ? ` from ${inlineCode(file.previousPath)}` : "";
    lines.push(`- **${file.status}**: ${inlineCode(file.path)}${previous}`);
  }
  if (input.changedFilesTruncated) {
    lines.push("", "_Changed-file list truncated. Use JSON or narrow the review scope as needed._");
  }

  lines.push("", "## Validation results");
  if (!input.validationResults.length) lines.push("", "_Not run._");
  for (const result of input.validationResults) {
    const exit = result.exitCode === null ? "none" : String(result.exitCode);
    lines.push(
      "",
      `### ${inlineCode(result.command)}`,
      "",
      `Status: **${result.status}**; exit code: ${inlineCode(exit)}`,
    );
    if (result.outputTruncated) lines.push("", "_Output truncated._");
    lines.push("", ...codeBlock(result.output));
  }
  return `${lines.join("\n")}\n`;
}

export function jsonReport(input: ReviewResult): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}
