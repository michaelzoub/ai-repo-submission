import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("preserves repository paths containing spaces", () => {
    const args = parseArgs(["review", "--repo", "/tmp/repo with spaces", "--format", "json", "--max-output-tokens", "512", "--no-ai"]);
    expect(args.repositoryPath).toBe("/tmp/repo with spaces");
    expect(args.format).toBe("json");
    expect(args.maxOutputTokens).toBe(512);
    expect(args.aiEnabled).toBe(false);
  });

  it("rejects missing values and unknown options", () => {
    expect(() => parseArgs(["review", "--repo"])).toThrow("--repo requires a value");
    expect(() => parseArgs(["review", "--wat", "value"])).toThrow("Unknown option");
    expect(() => parseArgs(["review", "--validate", "npm test"])).toThrow("Unknown option");
    expect(() => parseArgs(["review", "--output", "report.md"])).toThrow("Unknown option");
    expect(() => parseArgs(["review", "--max-output-tokens", "12"])).toThrow("between 256 and 8000");
  });
});
