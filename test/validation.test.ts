import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runValidation } from "../src/validation.js";

const cwd = mkdtempSync(join(tmpdir(), "inspector-validation-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

describe("validation", () => {
  it("records a failed command instead of rejecting the review", async () => {
    const result = await runValidation(
      nodeCommand("console.error('failure detail'); process.exit(7)"),
      cwd,
    );
    expect(result).toMatchObject({ status: "failed", exitCode: 7, outputTruncated: false });
    expect(result.output).toContain("failure detail");
  });

  it("times out and bounds output", async () => {
    const timeout = await runValidation(nodeCommand("setTimeout(() => {}, 10000)"), cwd, 30);
    expect(timeout.status).toBe("timed_out");

    const noisy = await runValidation(nodeCommand("process.stdout.write('x'.repeat(70000))"), cwd);
    expect(noisy.status).toBe("passed");
    expect(noisy.outputTruncated).toBe(true);
    expect(Buffer.byteLength(noisy.output)).toBeLessThan(66_000);
  });
});
