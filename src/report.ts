import type { ReviewResult, SemanticAnalysis, ValidationResult } from "./types.js";

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

  return `${lines.join("\n")}\n`;
}

export function jsonReport(input: ReviewResult): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

function plainText(value: string): string {
  return printable(value)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\`*_{}\[\]()<>#+\-.!|])/g, "\\$1");
}

function shortened(value: string, maxCharacters: number): string {
  const safe = plainText(value);
  if (safe.length <= maxCharacters) return safe;
  return `${safe.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
}

function shortenedLiteral(value: string, maxCharacters: number): string {
  const safe = printable(value).replace(/\s+/g, " ").trim();
  if (safe.length <= maxCharacters) return safe;
  return `${safe.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
}

export type SemanticReportInput = ReviewResult & {
  analysis: SemanticAnalysis;
  validation: ValidationResult[];
  evidence: { filesConsidered: number; filesWithPatches: number; truncated: boolean };
};

export function semanticMarkdownReport(
  input: SemanticReportInput,
  maxOutputTokens: number,
): { report: string; truncated: boolean } {
  const maxCharacters = maxOutputTokens * 4;
  let summary = shortened(input.analysis.summary, 500);
  let changes = input.analysis.importantChanges.map((change) =>
    `- **${shortened(change.title, 140)}** — ${shortened(change.impact, 360)}` +
    (change.files.length ? ` (${change.files.map(inlineCode).join(", ")})` : ""),
  );
  let details = input.analysis.fileDetails.map((detail) =>
    `- ${inlineCode(detail.path)} — ${shortened(detail.detail, 360)}`,
  );
  const validationLines = (detailLength: number): string[] => [
    ...input.validation.map((result) =>
      `- **${result.status.replaceAll("_", " ")} — ${shortened(result.name, 100)}:** ${shortened(result.details, detailLength)}`,
    ),
    `- **Inspection coverage:** patches read for ${input.evidence.filesWithPatches} of ${input.evidence.filesConsidered} prioritized files` +
      (input.evidence.truncated ? "; evidence was bounded or truncated." : "."),
  ];
  let validation = validationLines(220);

  const render = (): string => `${[
    "# Repository Review",
    "",
    "## Summary",
    "",
    summary,
    "",
    "## Important changes + impact",
    "",
    ...(changes.length ? changes : ["_No important semantic changes identified._"]),
    "",
    "## Validation results",
    "",
    ...validation,
    "",
    "## Per-file details",
    "",
    ...(details.length ? details : ["_No additional file-level details._"]),
  ].join("\n")}\n`;

  const originalChangeCount = changes.length;
  const originalDetailCount = details.length;
  while (render().length > maxCharacters && details.length) details = details.slice(0, -1);
  while (render().length > maxCharacters && changes.length > 1) changes = changes.slice(0, -1);
  if (render().length > maxCharacters) summary = shortened(summary, 220);
  if (render().length > maxCharacters) validation = validationLines(100);
  while (render().length > maxCharacters && changes.length) changes = changes.slice(0, -1);
  while (render().length > maxCharacters && validation.length > 1) validation = validation.slice(0, -1);

  const report = render();
  return {
    report: report.length <= maxCharacters ? report : `${report.slice(0, Math.max(0, maxCharacters - 2)).trimEnd()}\n`,
    truncated: report.length > maxCharacters || changes.length < originalChangeCount || details.length < originalDetailCount,
  };
}

export function boundedFallbackMarkdown(
  input: ReviewResult,
  maxOutputTokens: number,
): { report: string; truncated: boolean } {
  const maxCharacters = maxOutputTokens * 4;
  const originalReport = markdownReport(input);
  if (originalReport.length <= maxCharacters) return { report: originalReport, truncated: false };
  let shown = input.changedFiles.length;
  const compactInput = (count: number): ReviewResult => ({
    ...input,
    repositoryPath: shortenedLiteral(input.repositoryPath, 240),
    baseRef: shortenedLiteral(input.baseRef, 120),
    comparisonRef: shortenedLiteral(input.comparisonRef, 120),
    changedFiles: input.changedFiles.slice(0, count).map((file) => ({
      ...file,
      path: shortenedLiteral(file.path, 240),
      ...(file.previousPath ? { previousPath: shortenedLiteral(file.previousPath, 240) } : {}),
    })),
    changedFilesTruncated: input.changedFilesTruncated || count < input.changedFiles.length,
  });
  let report = markdownReport(compactInput(shown));
  while (report.length > maxCharacters && shown > 0) {
    shown--;
    report = markdownReport(compactInput(shown));
  }
  if (report.length > maxCharacters) report = `${report.slice(0, Math.max(0, maxCharacters - 2)).trimEnd()}\n`;
  return { report, truncated: true };
}
