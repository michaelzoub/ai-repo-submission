export type ChangedFile = {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked";
};

export type ValidationResult = {
  command: string;
  status: "passed" | "failed" | "timed_out";
  exitCode: number | null;
  output: string;
  outputTruncated: boolean;
};

export type ReviewRequest = {
  repositoryPath: string;
  baseRef?: string;
  validationCommands?: string[];
  validationTimeoutMs?: number;
};

export type ReviewPolicy = {
  allowedRoots?: string[];
  allowValidation?: boolean;
  maxChangedFiles?: number;
};

export type ReviewResult = {
  repositoryPath: string;
  baseRef: string;
  comparisonRef: string;
  changedFiles: ChangedFile[];
  totalChangedFiles: number;
  changedFilesTruncated: boolean;
  validationResults: ValidationResult[];
};
