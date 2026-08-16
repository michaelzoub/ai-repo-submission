import type { ReviewOutcome, ReviewResult, SemanticAnalysis, ValidationResult } from "./types.js";

type EvidenceSummary = ReviewOutcome["evidence"];

type DeterministicReportInput = ReviewResult & {
  fallbackReason?: ReviewOutcome["fallbackReason"];
  validation?: ValidationResult[];
  evidence?: EvidenceSummary;
};

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

export function markdownReport(input: DeterministicReportInput): string {
  const reason = input.fallbackReason === "disabled"
    ? "External AI analysis was disabled."
    : input.fallbackReason === "unavailable"
      ? "External AI analysis was requested, but no configured analyzer was available."
      : input.fallbackReason === "failed"
        ? "External AI analysis failed, so the deterministic report was used."
        : input.fallbackReason === "malformed"
          ? "External AI returned an invalid result, so the deterministic report was used."
          : "The deterministic report was used.";
  const summary = `${reason} Git reports ${input.totalChangedFiles} changed file(s) relative to ${input.baseRef}.`;
  const changes = input.changedFiles.map((file) => {
    const previous = file.previousPath ? ` from ${inlineCode(file.previousPath)}` : "";
    return `- **${shortened(`${file.status} file`, 140)}** — Git reports ${inlineCode(file.path)} as ${file.status}${previous}.`;
  });
  const validation = (input.validation ?? []).map((result) =>
    `- **${result.status.replaceAll("_", " ")} — ${shortened(result.name, 100)}:** ${shortened(result.details, 220)} ` +
    `(command: ${inlineCode(shortenedLiteral(result.command, 180))})`,
  );
  if (input.evidence) {
    validation.push(
      `- **Inspection evidence:** ${input.evidence.filesWithPatches} patch(es), ${input.evidence.totalPatchBytes} byte(s), ` +
      `${input.evidence.totalPatchTokens} conservative token(s); truncated: ${input.evidence.truncated ? "yes" : "no"}; ` +
      `${input.evidence.filesOmitted} file(s) omitted, including ${input.evidence.binaryFilesExcluded} binary and ` +
      `${input.evidence.sensitiveFilesExcluded} potentially sensitive file(s).`,
    );
  }
  const details = input.changedFiles.map((file) => {
    const previous = file.previousPath ? `; previous path: ${inlineCode(file.previousPath)}` : "";
    return `- ${inlineCode(file.path)} — Git status: ${file.status}${previous}.`;
  });
  if (input.changedFilesTruncated) details.push("*Additional changed-file details were omitted by the configured limit.*");

  return `${[
    "# Repository Review",
    "",
    "## Summary",
    "",
    shortened(summary, 500),
    "",
    "## Important changes + impact",
    "",
    ...(changes.length ? changes : ["*No changed files were detected.*"]),
    "",
    "## Likely improvements",
    "",
    "*Not inferred: deterministic mode does not generate semantic improvement claims.*",
    "",
    "## Regression risks",
    "",
    "*Not inferred: deterministic mode does not generate semantic regression claims.*",
    "",
    "## Validation results",
    "",
    ...(validation.length ? validation : ["*No validation results were produced.*"]),
    "",
    "## Per-file details",
    "",
    ...(details.length ? details : ["*No additional file-level details.*"]),
  ].join("\n")}\n`;
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
  evidence: EvidenceSummary;
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
  let improvements = input.analysis.likelyImprovements.map((improvement) =>
    `- **Likely improvement — ${shortened(improvement.title, 140)}:** ${shortened(improvement.rationale, 360)}` +
    (improvement.files.length ? ` (${improvement.files.map(inlineCode).join(", ")})` : ""),
  );
  let risks = input.analysis.regressionRisks.map((risk) =>
    `- **Regression risk — ${shortened(risk.title, 140)}:** ${shortened(risk.rationale, 360)}` +
    (risk.files.length ? ` (${risk.files.map(inlineCode).join(", ")})` : ""),
  );
  let details = input.analysis.fileDetails.map((detail) =>
    `- ${inlineCode(detail.path)} — ${shortened(detail.detail, 360)}`,
  );
  const validationLines = (detailLength: number): string[] => [
    ...input.validation.map((result) =>
      `- **${result.status.replaceAll("_", " ")} — ${shortened(result.name, 100)}:** ${shortened(result.details, detailLength)} ` +
      `(command: ${inlineCode(shortenedLiteral(result.command, 180))})`,
    ),
    `- **AI evidence:** ${input.evidence.filesWithPatches} patch(es), ${input.evidence.totalPatchBytes} byte(s), ` +
      `${input.evidence.totalPatchTokens} conservative token(s); truncated: ${input.evidence.truncated ? "yes" : "no"}; ` +
      `${input.evidence.filesOmitted} file(s) omitted, including ${input.evidence.binaryFilesExcluded} binary and ` +
      `${input.evidence.sensitiveFilesExcluded} potentially sensitive file(s).`,
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
    ...(changes.length ? changes : ["*No important semantic changes identified.*"]),
    "",
    "## Likely improvements",
    "",
    ...(improvements.length ? improvements : ["*No likely improvements identified from the bounded evidence.*"]),
    "",
    "## Regression risks",
    "",
    ...(risks.length ? risks : ["*No specific regression risks identified from the bounded evidence.*"]),
    "",
    "## Validation results",
    "",
    ...validation,
    "",
    "## Per-file details",
    "",
    ...(details.length ? details : ["*No additional file-level details.*"]),
  ].join("\n")}\n`;

  const originalChangeCount = changes.length;
  const originalImprovementCount = improvements.length;
  const originalRiskCount = risks.length;
  const originalDetailCount = details.length;
  while (render().length > maxCharacters && details.length) details = details.slice(0, -1);
  while (render().length > maxCharacters && risks.length) risks = risks.slice(0, -1);
  while (render().length > maxCharacters && improvements.length) improvements = improvements.slice(0, -1);
  while (render().length > maxCharacters && changes.length > 1) changes = changes.slice(0, -1);
  if (render().length > maxCharacters) summary = shortened(summary, 220);
  if (render().length > maxCharacters) validation = validationLines(100);
  while (render().length > maxCharacters && changes.length) changes = changes.slice(0, -1);
  while (render().length > maxCharacters && validation.length > 1) validation = validation.slice(0, -1);

  const report = render();
  return {
    report: report.length <= maxCharacters ? report : `${report.slice(0, Math.max(0, maxCharacters - 2)).trimEnd()}\n`,
    truncated: report.length > maxCharacters || changes.length < originalChangeCount ||
      improvements.length < originalImprovementCount || risks.length < originalRiskCount || details.length < originalDetailCount,
  };
}

export function boundedFallbackMarkdown(
  input: DeterministicReportInput,
  maxOutputTokens: number,
): { report: string; truncated: boolean } {
  const maxCharacters = maxOutputTokens * 4;
  const originalReport = markdownReport(input);
  if (originalReport.length <= maxCharacters) return { report: originalReport, truncated: false };
  let shown = input.changedFiles.length;
  const compactInput = (count: number): DeterministicReportInput => ({
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
