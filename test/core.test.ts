import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewRepository } from "../src/core.js";
import { OpenRouterAnalyzer } from "../src/openrouter.js";
import { markdownReport } from "../src/report.js";
import type { ChangeAnalyzer, SemanticAnalysis } from "../src/types.js";
import { createGitFixture } from "./helpers.js";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function fixtureWithChange(): string {
  const repositoryPath = createGitFixture();
  fixtures.push(repositoryPath);
  writeFileSync(join(repositoryPath, "old name.txt"), "updated behavior\n");
  return repositoryPath;
}

const validAnalysis: SemanticAnalysis = {
  summary: "The review flow now compresses the repository change.",
  importantChanges: [{
    title: "Shared semantic review",
    impact: "Developers receive one prioritized result through every adapter.",
    files: ["old name.txt"],
  }],
  likelyImprovements: [{
    title: "More focused output",
    rationale: "The bounded semantic summary is likely easier to scan.",
    files: ["old name.txt"],
  }],
  regressionRisks: [{
    title: "Changed output shape",
    rationale: "Consumers may depend on the previous wording.",
    files: ["old name.txt"],
  }],
  fileDetails: [{ path: "old name.txt", detail: "Updates the behavior used by the review." }],
};

describe("review orchestration", () => {
  it("renders validated AI structure in the developer-oriented section order", async () => {
    const repositoryPath = fixtureWithChange();
    const analyze = vi.fn(async (input) => {
      expect(input.evidence.files[0].patch).toContain("updated behavior");
      return validAnalysis;
    });
    const result = await reviewRepository(
      { repositoryPath, baseRef: "main", aiEnabled: true },
      { analyzer: { analyze }, maxOutputTokens: 512 },
    );

    expect(result.analysisMode).toBe("ai");
    expect(result.report.indexOf("## Summary")).toBeLessThan(result.report.indexOf("## Important changes + impact"));
    expect(result.report.indexOf("## Important changes + impact")).toBeLessThan(result.report.indexOf("## Validation results"));
    expect(result.report.indexOf("## Validation results")).toBeLessThan(result.report.indexOf("## Per-file details"));
    expect(result.report).toContain("Shared semantic review");
    expect(result.report.length).toBeLessThanOrEqual(512 * 4);
  });

  it.each([
    ["malformed", { analyze: async () => ({ summary: "missing arrays" }) } satisfies ChangeAnalyzer],
    ["failed", { analyze: async () => { throw new Error("provider unavailable"); } } satisfies ChangeAnalyzer],
  ])("uses the unchanged deterministic report when AI is %s", async (reason, analyzer) => {
    const repositoryPath = fixtureWithChange();
    const result = await reviewRepository({ repositoryPath, baseRef: "main", aiEnabled: true }, { analyzer });

    expect(result.analysisMode).toBe("deterministic");
    expect(result.fallbackReason).toBe(reason);
    expect(result.report).toBe(markdownReport(result));
  });

  it("does not call a configured analyzer when AI is disabled", async () => {
    const repositoryPath = fixtureWithChange();
    const analyze = vi.fn(async () => validAnalysis);
    const result = await reviewRepository(
      { repositoryPath, baseRef: "main", aiEnabled: false },
      { analyzer: { analyze } },
    );
    expect(analyze).not.toHaveBeenCalled();
    expect(result.fallbackReason).toBe("disabled");
  });

  it("uses explicit request authorization independently of provider environment parsing", async () => {
    const repositoryPath = fixtureWithChange();
    vi.stubEnv("INSPECTOR_AI_ENABLED", "false");
    const result = await reviewRepository(
      { repositoryPath, baseRef: "main", aiEnabled: true },
      { analyzer: { analyze: async () => validAnalysis } },
    );

    expect(result.analysisMode).toBe("ai");
  });

  it("falls back when provider environment configuration is invalid", async () => {
    const repositoryPath = fixtureWithChange();
    vi.stubEnv("OPENROUTER_API_KEY", "configured-key");
    vi.stubEnv("OPENROUTER_BASE_URL", "http://insecure.example.test");
    const result = await reviewRepository({ repositoryPath, baseRef: "main", aiEnabled: true });
    expect(result.analysisMode).toBe("deterministic");
    expect(result.fallbackReason).toBe("failed");
  });

  it("falls back to the deterministic report when OpenRouter times out", async () => {
    const repositoryPath = fixtureWithChange();
    const analyzer = new OpenRouterAnalyzer({
      apiKey: "test-key",
      timeoutMs: 5,
      fetchImplementation: (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    const result = await reviewRepository({ repositoryPath, baseRef: "main", aiEnabled: true }, { analyzer });

    expect(result.analysisMode).toBe("deterministic");
    expect(result.fallbackReason).toBe("failed");
    expect(result.report).toBe(markdownReport(result));
  });

  it("enforces the report budget and escapes model-supplied Markdown", async () => {
    const repositoryPath = fixtureWithChange();
    const longAnalysis: SemanticAnalysis = {
      summary: "# injected heading " + "summary ".repeat(60),
      importantChanges: Array.from({ length: 8 }, (_, index) => ({
        title: `*change ${index}*`,
        impact: "impact ".repeat(45),
        files: ["old name.txt"],
      })),
      likelyImprovements: Array.from({ length: 6 }, (_, index) => ({
        title: `improvement ${index}`,
        rationale: "likely improvement ".repeat(15),
        files: ["old name.txt"],
      })),
      regressionRisks: Array.from({ length: 6 }, (_, index) => ({
        title: `risk ${index}`,
        rationale: "regression risk ".repeat(20),
        files: ["old name.txt"],
      })),
      fileDetails: [{
        path: "old name.txt",
        detail: "detail " + "content ".repeat(40),
      }],
    };
    const result = await reviewRepository(
      { repositoryPath, baseRef: "main", aiEnabled: true },
      { analyzer: { analyze: async () => longAnalysis }, maxOutputTokens: 256 },
    );
    expect(result.report.length).toBeLessThanOrEqual(1_024);
    expect(result.report).toContain("\\# injected heading");
    expect(result.outputTruncated).toBe(true);
  });
});
