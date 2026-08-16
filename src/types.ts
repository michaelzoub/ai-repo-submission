export type ChangedFile = {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked";
};

export type ReviewRequest = {
  repositoryPath: string;
  baseRef?: string;
  aiEnabled?: boolean;
};

export type ReviewPolicy = {
  allowedRoots?: string[];
  maxChangedFiles?: number;
  maxFilesAnalyzed?: number;
  maxPatchBytes?: number;
  maxPatchBytesPerFile?: number;
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
  patch?: string;
  patchBytes: number;
  patchTruncated: boolean;
  binary: boolean;
  omittedReason?: "binary" | "sensitive_path" | "unsupported_file" | "read_error" | "budget";
};

export type DiffEvidence = {
  files: FileEvidence[];
  filesConsidered: number;
  totalPatchBytes: number;
  truncated: boolean;
};

export type ValidationResult = {
  name: string;
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
  fileDetails: Array<{
    path: string;
    detail: string;
  }>;
};

export type AnalysisInput = {
  baseRef: string;
  comparisonRef: string;
  changedFiles: ChangedFile[];
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
    truncated: boolean;
  };
  report: string;
  outputTokenBudget: number;
  outputTruncated: boolean;
};
