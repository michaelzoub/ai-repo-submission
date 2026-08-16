import { exec, type ExecException } from "node:child_process";
import type { ValidationResult } from "./types.js";

export const DEFAULT_VALIDATION_TIMEOUT_MS = 120_000;
export const MAX_VALIDATION_OUTPUT_BYTES = 64 * 1024;

function limitOutput(output: string): { output: string; truncated: boolean } {
  const bytes = Buffer.from(output);
  if (bytes.length <= MAX_VALIDATION_OUTPUT_BYTES) return { output, truncated: false };
  return {
    output: `${bytes.subarray(0, MAX_VALIDATION_OUTPUT_BYTES).toString("utf8")}\n… output truncated …`,
    truncated: true,
  };
}

function exitCode(error: ExecException): number | null {
  return typeof error.code === "number" ? error.code : null;
}

export function runValidation(
  command: string,
  cwd: string,
  timeoutMs = DEFAULT_VALIDATION_TIMEOUT_MS,
): Promise<ValidationResult> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: MAX_VALIDATION_OUTPUT_BYTES * 2 },
      (error, stdout, stderr) => {
        const combined = [stdout, stderr].filter(Boolean).join("\n").trimEnd();
        const limited = limitOutput(combined);
        const timedOut = Boolean(error?.killed && error.signal);
        resolve({
          command,
          status: timedOut ? "timed_out" : error ? "failed" : "passed",
          exitCode: error ? exitCode(error) : 0,
          output: limited.output,
          outputTruncated:
            limited.truncated || Boolean(error?.message.includes("maxBuffer")),
        });
      },
    );
  });
}

export async function runValidations(
  commands: string[],
  cwd: string,
  timeoutMs = DEFAULT_VALIDATION_TIMEOUT_MS,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const command of commands) {
    results.push(await runValidation(command, cwd, timeoutMs));
  }
  return results;
}
