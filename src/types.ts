export type ChangedFile = {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked";
};

export type ReviewRequest = {
  repositoryPath: string;
  baseRef?: string;
  aiEnabled?: boolean;
  additionalValidation?: ValidationResult[];
};

export type ReviewPolicy = {
  allowedRoots?: string[];
  maxChangedFiles?: number;
  maxFilesAnalyzed?: number;
  maxPatchBytes?: number;
  maxPatchBytesPerFile?: number;
  maxPatchTokens?: number;
  maxPatchTokensPerFile?: number;
  maxOutputTokens?: number;
  analyzer?: ChangeAnalyzer;
  aiEnabled?: boolean;
};

export type ReviewResult = {
  repositoryPath: string;
  baseRef: string;
  comparisonRef: string;
  changedFiles: ChangedFile[];
  totalChangedFiles: number;
  changedFilesTruncated: boolean;
};

export type FileEvidence = ChangedFile & {
  patch: string;
  patchBytes: number;
  /** Conservative upper bound for provider-token usage. */
  patchTokens: number;
  patchTruncated: boolean;
};

export type DiffEvidence = {
  files: FileEvidence[];
  filesConsidered: number;
  totalPatchBytes: number;
  totalPatchTokens: number;
  filesOmitted: number;
  binaryFilesExcluded: number;
  sensitiveFilesExcluded: number;
  limits: {
    maxFiles: number;
    maxPatchBytes: number;
    maxPatchBytesPerFile: number;
    maxPatchTokens: number;
    maxPatchTokensPerFile: number;
  };
  truncated: boolean;
};

export type ValidationResult = {
  name: string;
  command: string;
  status: "passed" | "failed" | "not_run";
  details: string;
};

export type SemanticAnalysis = {
  summary: string;
  importantChanges: Array<{
    title: string;
    impact: string;
    files: string[];
  }>;
  likelyImprovements: Array<{
    title: string;
    rationale: string;
    files: string[];
  }>;
  regressionRisks: Array<{
    title: string;
    rationale: string;
    files: string[];
  }>;
  fileDetails: Array<{
    path: string;
    detail: string;
  }>;
};

export type AnalysisInput = {
  evidence: DiffEvidence;
  validation: ValidationResult[];
  maxOutputTokens: number;
};

/** Provider-neutral contract. Implementations return untrusted data that the core validates. */
export interface ChangeAnalyzer {
  analyze(input: AnalysisInput): Promise<unknown>;
}

export type ReviewOutcome = ReviewResult & {
  analysisMode: "ai" | "deterministic";
  fallbackReason?: "disabled" | "unavailable" | "failed" | "malformed";
  analysis?: SemanticAnalysis;
  validation: ValidationResult[];
  evidence: {
    filesConsidered: number;
    filesWithPatches: number;
    totalPatchBytes: number;
    totalPatchTokens: number;
    filesOmitted: number;
    binaryFilesExcluded: number;
    sensitiveFilesExcluded: number;
    truncated: boolean;
  };
  report: string;
  outputTokenBudget: number;
  outputTruncated: boolean;
};
