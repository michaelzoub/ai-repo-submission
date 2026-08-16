import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp-server.js";
import { createGitFixture } from "./helpers.js";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("MCP contract", () => {
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
        fallback_reason: "unavailable",
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
});
