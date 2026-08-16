import { describe, expect, it, vi } from "vitest";
import { createOpenRouterAnalyzerFromEnvironment, OpenRouterAnalyzer } from "../src/openrouter.js";
import type { AnalysisInput } from "../src/types.js";

const input: AnalysisInput = {
  baseRef: "main",
  comparisonRef: "abc123",
  changedFiles: [{ path: "src/core.ts", status: "modified" }],
  evidence: {
    files: [{ path: "src/core.ts", status: "modified", patch: "+new behavior", patchBytes: 13, patchTruncated: false, binary: false }],
    filesConsidered: 1,
    totalPatchBytes: 13,
    truncated: false,
  },
  validation: [{ name: "Git diff check", status: "passed", details: "No errors." }],
  maxOutputTokens: 512,
};

describe("OpenRouterAnalyzer", () => {
  it("calls the chat completions API with bounded structured input", async () => {
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-key");
      const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> };
      expect(body.model).toBe("test/model");
      expect(body.messages[1].content).toContain("+new behavior");
      expect(body.messages[1].content).not.toContain(process.cwd());
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ summary: "Summary", importantChanges: [], fileDetails: [] }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const analyzer = new OpenRouterAnalyzer({ apiKey: "test-key", model: "test/model", fetchImplementation });

    await expect(analyzer.analyze(input)).resolves.toEqual({ summary: "Summary", importantChanges: [], fileDetails: [] });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("is disabled cleanly by environment configuration", () => {
    expect(createOpenRouterAnalyzerFromEnvironment({
      OPENROUTER_API_KEY: "test-key",
      INSPECTOR_AI_ENABLED: "false",
    })).toBeUndefined();
  });
});
