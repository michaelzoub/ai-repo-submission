import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, parseArgs, runValidationCommand } from "../src/cli.js";
import { createGitFixture } from "./helpers.js";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseArgs", () => {
  it("preserves repository paths containing spaces", () => {
    const args = parseArgs(["review", "--repo", "/tmp/repo with spaces", "--format", "json", "--max-output-tokens", "512", "--no-ai"]);
    expect(args.repositoryPath).toBe("/tmp/repo with spaces");
    expect(args.format).toBe("json");
    expect(args.maxOutputTokens).toBe(512);
    expect(args.aiEnabled).toBe(false);
  });

  it("requires explicit AI opt-in and accepts bounded local validation", () => {
    expect(parseArgs(["review", "--repo", "."]).aiEnabled).toBeUndefined();
    expect(parseArgs(["review", "--repo", ".", "--ai"]).aiEnabled).toBe(true);
    expect(parseArgs(["review", "--repo", ".", "--validate", "npm test"]).validationCommand).toBe("npm test");
  });

  it("rejects missing values and unknown options", () => {
    expect(() => parseArgs(["review", "--repo"])).toThrow("--repo requires a value");
    expect(() => parseArgs(["review", "--wat", "value"])).toThrow("Unknown option");
    expect(() => parseArgs(["review", "--output", "report.md"])).toThrow("Unknown option");
    expect(() => parseArgs(["review", "--max-output-tokens", "12"])).toThrow("between 256 and 8000");
  });

  it("does not treat an API key alone as authorization for source egress", async () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "old name.txt"), "changed\n");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchImplementation = vi.fn();
    vi.stubGlobal("fetch", fetchImplementation);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    expect(await main(["review", "--repo", repositoryPath])).toBe(0);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("runs a local validation command and renders its result", async () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    writeFileSync(join(repositoryPath, "old name.txt"), "changed\n");
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });

    expect(await main([
      "review", "--repo", repositoryPath, "--validate", "node -e \"process.stdout.write('validation ok')\"",
    ])).toBe(0);
    expect(output.join("")).toContain("## Validation results");
    expect(output.join("")).toContain("validation ok");
  });

  it("limits validation output", () => {
    const repositoryPath = createGitFixture();
    fixtures.push(repositoryPath);
    const result = runValidationCommand(repositoryPath, "node -e \"process.stdout.write('x'.repeat(20000))\"");
    expect(result.details).toContain("output truncated at 16 KiB");
    expect(Buffer.byteLength(result.details)).toBeLessThan(17 * 1024);
  });

});
