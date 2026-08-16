import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as cliMain } from "../src/cli.js";
import { createMcpServer } from "../src/mcp-server.js";
import type { SemanticAnalysis } from "../src/types.js";
import { createGitFixture } from "./helpers.js";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sharedAnalysis: SemanticAnalysis = {
  summary: "The bounded evidence adds one text file.",
  importantChanges: [{ title: "New text file", impact: "The repository now includes the new content.", files: ["untracked.txt"] }],
  likelyImprovements: [{ title: "Documented behavior", rationale: "The addition is likely to make the behavior clearer.", files: ["untracked.txt"] }],
  regressionRisks: [{ title: "Consumer assumptions", rationale: "Consumers may need to account for the added file.", files: ["untracked.txt"] }],
  fileDetails: [{ path: "untracked.txt", detail: "Adds one line of text." }],
};

describe("MCP contract", () => {
  it("fails closed when the server explicitly configures no allowed roots", async () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ allowedRoots: [] });
    const client = new Client({ name: "empty-roots-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: "review_repository",
        arguments: { repo_path: repositoryPath, base_ref: "main" },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContainEqual(expect.objectContaining({
        type: "text",
        text: "Repository is outside the server's allowed roots.",
      }));
    } finally {
      await client.close();
    }
  });

  it("uses its advertised snake_case input and returns structured output", async () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "untracked.txt"), "new\n");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ allowedRoots: [repositoryPath] });
    const client = new Client({ name: "contract-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      const schema = tools.tools[0].inputSchema as { properties: Record<string, unknown> };
      expect(Object.keys(schema.properties)).toEqual(["repo_path", "base_ref", "max_output_tokens", "ai"]);

      const result = await client.callTool({
        name: "review_repository",
        arguments: { repo_path: repositoryPath, base_ref: "main" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        repository_path: realpathSync(repositoryPath),
        base_ref: "main",
        total_changed_files: 1,
        changed_files: [{ path: "untracked.txt", status: "untracked" }],
      });
      expect(result.structuredContent).toMatchObject({
        analysis_mode: "deterministic",
        fallback_reason: "disabled",
        evidence: { files_considered: 1, files_with_patches: 1 },
      });
      expect(result.content).toEqual([{
        type: "text",
        text: (result.structuredContent as { report_markdown: string }).report_markdown,
      }]);

      const denied = await client.callTool({
        name: "review_repository",
        arguments: { repo_path: process.cwd(), base_ref: "main" },
      });
      expect(denied.isError).toBe(true);
      expect(denied.content).toContainEqual(expect.objectContaining({
        type: "text",
        text: "Repository is outside the server's allowed roots.",
      }));
    } finally {
      await client.close();
    }
  });

  it("renders the same semantic analysis through CLI and MCP", async () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "untracked.txt"), "new\n");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("INSPECTOR_AI_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(sharedAnalysis) } }],
    }), { status: 200 })));
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });

    expect(await cliMain([
      "review", "--repo", repositoryPath, "--base-ref", "main", "--max-output-tokens", "512",
    ])).toBe(0);
    const cliReport = output.join("");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      allowedRoots: [repositoryPath],
      aiEnabled: true,
      analyzer: { analyze: async () => sharedAnalysis },
    });
    const client = new Client({ name: "consistency-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: "review_repository",
        arguments: { repo_path: repositoryPath, base_ref: "main", max_output_tokens: 512, ai: true },
      });
      expect(result.structuredContent).toMatchObject({ analysis_mode: "ai", report_markdown: cliReport });
      expect(result.content).toEqual([{ type: "text", text: cliReport }]);
    } finally {
      await client.close();
    }
  });

  it("does not let a client override disabled server AI policy", async () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "untracked.txt"), "new\n");
    const analyze = vi.fn(async () => sharedAnalysis);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ allowedRoots: [repositoryPath], aiEnabled: false, analyzer: { analyze } });
    const client = new Client({ name: "policy-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: "review_repository",
        arguments: { repo_path: repositoryPath, base_ref: "main", ai: true },
      });
      expect(result.structuredContent).toMatchObject({ analysis_mode: "deterministic", fallback_reason: "disabled" });
      expect(analyze).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("does not use server-enabled AI unless the client requests it", async () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "untracked.txt"), "new\n");
    const analyze = vi.fn(async () => sharedAnalysis);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ allowedRoots: [repositoryPath], aiEnabled: true, analyzer: { analyze } });
    const client = new Client({ name: "request-policy-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: "review_repository",
        arguments: { repo_path: repositoryPath, base_ref: "main" },
      });
      expect(result.structuredContent).toMatchObject({ analysis_mode: "deterministic", fallback_reason: "disabled" });
      expect(analyze).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});
