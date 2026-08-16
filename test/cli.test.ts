import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("preserves repository paths containing spaces", () => {
    const args = parseArgs(["review", "--repo", "/tmp/repo with spaces", "--format", "json"]);
    expect(args.repositoryPath).toBe("/tmp/repo with spaces");
    expect(args.format).toBe("json");
  });

  it("rejects missing values and unknown options", () => {
    expect(() => parseArgs(["review", "--repo"])).toThrow("--repo requires a value");
    expect(() => parseArgs(["review", "--wat", "value"])).toThrow("Unknown option");
  });
});
