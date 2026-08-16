#!/usr/bin/env node
import { delimiter } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reviewRepository } from "./core.js";
import { InspectionError } from "./git.js";
import { externalAiEnabledByEnvironment } from "./openrouter.js";
import type { ChangeAnalyzer } from "./types.js";

export type McpServerOptions = {
  allowedRoots: string[];
  maxChangedFiles?: number;
  maxOutputTokens?: number;
  aiEnabled?: boolean;
  analyzer?: ChangeAnalyzer;
};

function structuredResult(result: Awaited<ReturnType<typeof reviewRepository>>) {
  return {
    repository_path: result.repositoryPath,
    base_ref: result.baseRef,
    comparison_ref: result.comparisonRef,
    changed_files: result.changedFiles.map((file) => ({
      path: file.path,
      ...(file.previousPath ? { previous_path: file.previousPath } : {}),
      status: file.status,
    })),
    total_changed_files: result.totalChangedFiles,
    changed_files_truncated: result.changedFilesTruncated,
    analysis_mode: result.analysisMode,
    ...(result.fallbackReason ? { fallback_reason: result.fallbackReason } : {}),
    validation: result.validation,
    evidence: {
      files_considered: result.evidence.filesConsidered,
      files_with_patches: result.evidence.filesWithPatches,
      total_patch_bytes: result.evidence.totalPatchBytes,
      total_patch_tokens_upper_bound: result.evidence.totalPatchTokens,
      files_omitted: result.evidence.filesOmitted,
      binary_files_excluded: result.evidence.binaryFilesExcluded,
      sensitive_files_excluded: result.evidence.sensitiveFilesExcluded,
      truncated: result.evidence.truncated,
    },
    report_markdown: result.report,
    output_token_budget: result.outputTokenBudget,
    output_truncated: result.outputTruncated,
  };
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer({ name: "repository-inspector", version: "3.0.0" });
  const changedFileSchema = z.object({
    path: z.string(),
    previous_path: z.string().optional(),
    status: z.enum(["added", "modified", "deleted", "renamed", "copied", "untracked"]),
  });

  server.registerTool(
    "review_repository",
    {
      title: "Review Git repository",
      description:
        "Read-only review of committed, staged, unstaged, and untracked changes relative to a base ref. " +
        "The repository must be inside a server-configured allowed root. This server exposes no command-execution capability.",
      inputSchema: {
        repo_path: z.string().min(1).max(4096).describe("Repository path inside an allowed root."),
        base_ref: z.string().min(1).max(1024).optional().describe("Base commit or branch; defaults to main."),
        max_output_tokens: z.number().int().min(256).max(options.maxOutputTokens ?? 8_000).optional()
          .describe("Approximate Markdown output-token budget; defaults to the server policy or 1800."),
        ai: z.boolean().optional().describe("Request AI analysis. Effective only when server policy also enables external AI."),
      },
      outputSchema: {
        repository_path: z.string(),
        base_ref: z.string(),
        comparison_ref: z.string(),
        changed_files: z.array(changedFileSchema),
        total_changed_files: z.number().int().nonnegative(),
        changed_files_truncated: z.boolean(),
        analysis_mode: z.enum(["ai", "deterministic"]),
        fallback_reason: z.enum(["disabled", "unavailable", "failed", "malformed"]).optional(),
        validation: z.array(z.object({
          name: z.string(),
          command: z.string(),
          status: z.enum(["passed", "failed", "not_run"]),
          details: z.string(),
        })),
        evidence: z.object({
          files_considered: z.number().int().nonnegative(),
          files_with_patches: z.number().int().nonnegative(),
          total_patch_bytes: z.number().int().nonnegative(),
          total_patch_tokens_upper_bound: z.number().int().nonnegative(),
          files_omitted: z.number().int().nonnegative(),
          binary_files_excluded: z.number().int().nonnegative(),
          sensitive_files_excluded: z.number().int().nonnegative(),
          truncated: z.boolean(),
        }),
        report_markdown: z.string(),
        output_token_budget: z.number().int().positive(),
        output_truncated: z.boolean(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ repo_path, base_ref, max_output_tokens, ai }) => {
      try {
        const result = await reviewRepository(
          { repositoryPath: repo_path, baseRef: base_ref, aiEnabled: ai === true },
          {
            allowedRoots: options.allowedRoots,
            maxChangedFiles: options.maxChangedFiles,
            maxOutputTokens: max_output_tokens ?? options.maxOutputTokens,
            analyzer: options.analyzer,
            aiEnabled: options.aiEnabled === true,
          },
        );
        return {
          content: [{ type: "text" as const, text: result.report }],
          structuredContent: structuredResult(result),
        };
      } catch (error) {
        const message = error instanceof InspectionError ? error.message : "Repository review failed.";
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    },
  );
  return server;
}

function configuredRoots(): string[] {
  const setting = process.env.INSPECTOR_ALLOWED_ROOTS;
  return setting ? setting.split(delimiter).filter(Boolean) : [process.cwd()];
}

async function main(): Promise<void> {
  const server = createMcpServer({
    allowedRoots: configuredRoots(),
    aiEnabled: externalAiEnabledByEnvironment(),
  });
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
