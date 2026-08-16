import { changedFiles, InspectionError, resolveRepositoryPath } from "./git.js";
import type { ReviewPolicy, ReviewRequest, ReviewResult } from "./types.js";

const DEFAULT_MAX_CHANGED_FILES = 500;

export async function reviewRepository(
  request: ReviewRequest,
  policy: ReviewPolicy = {},
): Promise<ReviewResult> {
  const maxChangedFiles = policy.maxChangedFiles ?? DEFAULT_MAX_CHANGED_FILES;
  if (!Number.isInteger(maxChangedFiles) || maxChangedFiles < 1) {
    throw new InspectionError("Changed-file limit must be a positive integer.");
  }

  const repositoryPath = resolveRepositoryPath(request.repositoryPath, policy.allowedRoots);
  const baseRef = request.baseRef ?? "main";
  const changes = changedFiles(repositoryPath, baseRef);
  return {
    repositoryPath,
    baseRef,
    comparisonRef: changes.comparisonRef,
    changedFiles: changes.files.slice(0, maxChangedFiles),
    totalChangedFiles: changes.files.length,
    changedFilesTruncated: changes.files.length > maxChangedFiles,
  };
}
