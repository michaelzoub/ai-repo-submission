import { z } from "zod";
import type { SemanticAnalysis } from "./types.js";

const semanticAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  importantChanges: z.array(z.object({
    title: z.string().trim().min(1).max(140),
    impact: z.string().trim().min(1).max(360),
    files: z.array(z.string().min(1).max(4096)).max(5),
  }).strict()).max(8),
  likelyImprovements: z.array(z.object({
    title: z.string().trim().min(1).max(140),
    rationale: z.string().trim().min(1).max(360),
    files: z.array(z.string().min(1).max(4096)).max(5),
  }).strict()).max(6),
  regressionRisks: z.array(z.object({
    title: z.string().trim().min(1).max(140),
    rationale: z.string().trim().min(1).max(360),
    files: z.array(z.string().min(1).max(4096)).max(5),
  }).strict()).max(6),
  fileDetails: z.array(z.object({
    path: z.string().min(1).max(4096),
    detail: z.string().trim().min(1).max(360),
  }).strict()).max(12),
}).strict();

export function validateSemanticAnalysis(
  value: unknown,
  knownPaths: ReadonlySet<string>,
): SemanticAnalysis | undefined {
  const parsed = semanticAnalysisSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const referencedPaths = [
    ...parsed.data.importantChanges.flatMap((change) => change.files),
    ...parsed.data.likelyImprovements.flatMap((change) => change.files),
    ...parsed.data.regressionRisks.flatMap((risk) => risk.files),
    ...parsed.data.fileDetails.map((detail) => detail.path),
  ];
  if (referencedPaths.some((path) => !knownPaths.has(path))) return undefined;
  if (new Set(parsed.data.fileDetails.map((detail) => detail.path)).size !== parsed.data.fileDetails.length) {
    return undefined;
  }
  return parsed.data;
}
