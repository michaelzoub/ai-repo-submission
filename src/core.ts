import { changedFiles, InspectionError, resolveRepositoryPath } from "./git.js";
import type { ReviewPolicy, ReviewRequest, ReviewResult } from "./types.js";
import { runValidations } from "./validation.js";

const DEFAULT_MAX_CHANGED_FILES = 500;
const MAX_VALIDATION_TIMEOUT_MS = 10 * 60_000;

export async function reviewRepository(
  request: ReviewRequest,
  policy: ReviewPolicy = {},
): Promise<ReviewResult> {
  const commands = request.validationCommands ?? [];
  if (commands.length && !policy.allowValidation) {
    throw new InspectionError("Validation execution is not allowed by this interface.");
  }
  if (commands.some((command) => !command.trim())) {
    throw new InspectionError("Validation commands must not be empty.");
  }
  const timeoutMs = request.validationTimeoutMs ?? 120_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_VALIDATION_TIMEOUT_MS) {
    throw new InspectionError("Validation timeout must be between 1 and 600000 milliseconds.");
  }
  const maxChangedFiles = policy.maxChangedFiles ?? DEFAULT_MAX_CHANGED_FILES;
  if (!Number.isInteger(maxChangedFiles) || maxChangedFiles < 1) {
    throw new InspectionError("Changed-file limit must be a positive integer.");
  }

  const repositoryPath = resolveRepositoryPath(request.repositoryPath, policy.allowedRoots);
  const baseRef = request.baseRef ?? "main";
  const changes = changedFiles(repositoryPath, baseRef);
  const validations = await runValidations(
    commands,
    repositoryPath,
    timeoutMs,
  );
  return {
    repositoryPath,
    baseRef,
    comparisonRef: changes.comparisonRef,
    changedFiles: changes.files.slice(0, maxChangedFiles),
    totalChangedFiles: changes.files.length,
    changedFilesTruncated: changes.files.length > maxChangedFiles,
    validationResults: validations,
  };
}
