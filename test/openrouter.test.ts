import { describe, expect, it, vi } from "vitest";
import { createOpenRouterAnalyzerFromEnvironment, externalAiEnabledByEnvironment, OpenRouterAnalyzer } from "../src/openrouter.js";
import type { AnalysisInput } from "../src/types.js";

const input: AnalysisInput = {
  evidence: {
    files: [{ path: "src/core.ts", status: "modified", patch: "@@ -1 +1 @@\n-old behavior\n+new behavior\n", patchBytes: 42, patchTokens: 42, patchTruncated: false }],
    filesConsidered: 1,
    totalPatchBytes: 42,
    totalPatchTokens: 42,
    filesOmitted: 0,
    binaryFilesExcluded: 0,
    sensitiveFilesExcluded: 0,
    limits: {
      maxFiles: 40,
      maxPatchBytes: 98_304,
      maxPatchBytesPerFile: 16_384,
      maxPatchTokens: 24_000,
      maxPatchTokensPerFile: 4_000,
    },
    truncated: false,
  },
  validation: [{ name: "Git diff check", command: "git diff --check abc123 --", status: "passed", details: "No errors." }],
  maxOutputTokens: 512,
};

describe("OpenRouterAnalyzer", () => {
  it("calls the chat completions API with bounded structured input", async () => {
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-key");
      const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> };
      expect(body.model).toBe("test/model");
      const payload = JSON.parse(body.messages[1].content) as Record<string, unknown>;
      expect(payload).not.toHaveProperty("changedFiles");
      expect(payload).toMatchObject({ validation: [{ name: "Git diff check", status: "passed" }] });
      expect(body.messages[1].content).not.toContain("git diff --check");
      expect(body.messages[1].content).not.toContain("No errors.");
      expect(payload).toMatchObject({
        evidence: {
          truncated: false,
          files: [{ path: "src/core.ts", status: "modified", hunks: expect.stringContaining("+new behavior") }],
        },
      });
      expect(body.messages[1].content).not.toContain(process.cwd());
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          summary: "Summary",
          importantChanges: [],
          likelyImprovements: [],
          regressionRisks: [],
          fileDetails: [],
        }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const analyzer = new OpenRouterAnalyzer({ apiKey: "test-key", model: "test/model", fetchImplementation });

    await expect(analyzer.analyze(input)).resolves.toEqual({
      summary: "Summary",
      importantChanges: [],
      likelyImprovements: [],
      regressionRisks: [],
      fileDetails: [],
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("treats only an affirmative environment setting as AI authorization", () => {
    expect(externalAiEnabledByEnvironment({ OPENROUTER_API_KEY: "test-key" })).toBe(false);
    expect(externalAiEnabledByEnvironment({ INSPECTOR_AI_ENABLED: "false" })).toBe(false);
    expect(externalAiEnabledByEnvironment({ INSPECTOR_AI_ENABLED: "true" })).toBe(true);
    expect(createOpenRouterAnalyzerFromEnvironment({ OPENROUTER_API_KEY: "test-key" })).toBeDefined();
  });
});
