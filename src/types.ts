export type ChangedFile = {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked";
};

export type ReviewRequest = {
  repositoryPath: string;
  baseRef?: string;
};

export type ReviewPolicy = {
  allowedRoots?: string[];
  maxChangedFiles?: number;
};

export type ReviewResult = {
  repositoryPath: string;
  baseRef: string;
  comparisonRef: string;
  changedFiles: ChangedFile[];
  totalChangedFiles: number;
  changedFilesTruncated: boolean;
};
