import { validateSemanticAnalysis } from "./analysis.js";
import { changedFiles, collectDiffEvidence, InspectionError, resolveRepositoryPath, validateDiff } from "./git.js";
import { createOpenRouterAnalyzerFromEnvironment } from "./openrouter.js";
import { boundedFallbackMarkdown, semanticMarkdownReport } from "./report.js";
import type { ReviewOutcome, ReviewPolicy, ReviewRequest, ReviewResult } from "./types.js";

const DEFAULT_MAX_CHANGED_FILES = 500;
const DEFAULT_MAX_FILES_ANALYZED = 40;
const DEFAULT_MAX_PATCH_BYTES = 96 * 1024;
const DEFAULT_MAX_PATCH_BYTES_PER_FILE = 16 * 1024;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_800;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new InspectionError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

export async function reviewRepository(
  request: ReviewRequest,
  policy: ReviewPolicy = {},
): Promise<ReviewOutcome> {
  const maxChangedFiles = boundedInteger(policy.maxChangedFiles, DEFAULT_MAX_CHANGED_FILES, "Changed-file limit", 1, 5_000);
  const maxFilesAnalyzed = boundedInteger(policy.maxFilesAnalyzed, DEFAULT_MAX_FILES_ANALYZED, "Analyzed-file limit", 1, 200);
  const maxPatchBytes = boundedInteger(policy.maxPatchBytes, DEFAULT_MAX_PATCH_BYTES, "Patch-byte limit", 1_024, 1024 * 1024);
  const maxPatchBytesPerFile = boundedInteger(
    policy.maxPatchBytesPerFile,
    Math.min(DEFAULT_MAX_PATCH_BYTES_PER_FILE, maxPatchBytes),
    "Per-file patch-byte limit",
    512,
    maxPatchBytes,
  );
  const maxOutputTokens = boundedInteger(policy.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS, "Output-token limit", 256, 8_000);

  const repositoryPath = resolveRepositoryPath(request.repositoryPath, policy.allowedRoots);
  const baseRef = request.baseRef ?? "main";
  const changes = changedFiles(repositoryPath, baseRef);
  const basicResult: ReviewResult = {
    repositoryPath,
    baseRef,
    comparisonRef: changes.comparisonRef,
    changedFiles: changes.files.slice(0, maxChangedFiles),
    totalChangedFiles: changes.files.length,
    changedFilesTruncated: changes.files.length > maxChangedFiles,
  };

  const evidence = collectDiffEvidence(repositoryPath, changes.comparisonRef, basicResult.changedFiles, {
    maxFiles: maxFilesAnalyzed,
    maxPatchBytes,
    maxPatchBytesPerFile,
  });
  const validation = validateDiff(repositoryPath, changes.comparisonRef);
  const evidenceSummary = {
    filesConsidered: evidence.filesConsidered,
    filesWithPatches: evidence.files.filter((file) => Boolean(file.patch)).length,
    totalPatchBytes: evidence.totalPatchBytes,
    truncated: evidence.truncated || basicResult.changedFilesTruncated,
  };

  const aiEnabled = request.aiEnabled ?? policy.aiEnabled ?? true;
  let fallbackReason: ReviewOutcome["fallbackReason"] = aiEnabled ? "unavailable" : "disabled";
  let analyzer = policy.analyzer;
  if (aiEnabled && !analyzer) {
    try {
      analyzer = createOpenRouterAnalyzerFromEnvironment();
    } catch {
      fallbackReason = "failed";
    }
  }

  if (aiEnabled && analyzer && basicResult.changedFiles.length) {
    try {
      const rawAnalysis = await analyzer.analyze({
        baseRef,
        comparisonRef: changes.comparisonRef,
        changedFiles: basicResult.changedFiles,
        evidence,
        validation,
        maxOutputTokens,
      });
      const analysis = validateSemanticAnalysis(rawAnalysis, new Set(basicResult.changedFiles.map((file) => file.path)));
      if (analysis) {
        const rendered = semanticMarkdownReport(
          { ...basicResult, analysis, validation, evidence: evidenceSummary },
          maxOutputTokens,
        );
        return {
          ...basicResult,
          analysisMode: "ai",
          analysis,
          validation,
          evidence: evidenceSummary,
          report: rendered.report,
          outputTokenBudget: maxOutputTokens,
          outputTruncated: rendered.truncated,
        };
      }
      fallbackReason = "malformed";
    } catch {
      fallbackReason = "failed";
    }
  }

  const fallback = boundedFallbackMarkdown(basicResult, maxOutputTokens);
  return {
    ...basicResult,
    analysisMode: "deterministic",
    fallbackReason,
    validation,
    evidence: evidenceSummary,
    report: fallback.report,
    outputTokenBudget: maxOutputTokens,
    outputTruncated: fallback.truncated,
  };
}
