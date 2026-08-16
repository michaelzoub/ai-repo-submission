#!/usr/bin/env node
import { delimiter } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reviewRepository } from "./core.js";
import { InspectionError } from "./git.js";

export type McpServerOptions = {
  allowedRoots: string[];
  maxChangedFiles?: number;
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
  };
}

function compactSummary(result: Awaited<ReturnType<typeof reviewRepository>>): string {
  const truncation = result.changedFilesTruncated ? "; result truncated" : "";
  return `Repository review: ${result.totalChangedFiles} changed files; ${result.changedFiles.length} returned${truncation}.`;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer({ name: "repository-inspector", version: "2.0.0" });
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
      },
      outputSchema: {
        repository_path: z.string(),
        base_ref: z.string(),
        comparison_ref: z.string(),
        changed_files: z.array(changedFileSchema),
        total_changed_files: z.number().int().nonnegative(),
        changed_files_truncated: z.boolean(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ repo_path, base_ref }) => {
      try {
        const result = await reviewRepository(
          { repositoryPath: repo_path, baseRef: base_ref },
          {
            allowedRoots: options.allowedRoots,
            maxChangedFiles: options.maxChangedFiles,
          },
        );
        return {
          content: [{ type: "text" as const, text: compactSummary(result) }],
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
  const server = createMcpServer({ allowedRoots: configuredRoots() });
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
