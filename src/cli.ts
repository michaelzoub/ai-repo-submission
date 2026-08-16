#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { reviewRepository } from "./core.js";
import { InspectionError, resolveRepositoryPath } from "./git.js";
import { externalAiEnabledByEnvironment } from "./openrouter.js";
import { jsonReport } from "./report.js";
import type { ValidationResult } from "./types.js";

const VALIDATION_TIMEOUT_MS = 60_000;
const VALIDATION_MAX_OUTPUT_BYTES = 16 * 1024;

export type CliArgs = {
  command: string;
  repositoryPath?: string;
  baseRef?: string;
  format: "markdown" | "json";
  aiEnabled?: boolean;
  validationCommand?: string;
  maxOutputTokens?: number;
  help: boolean;
};

const USAGE = `Usage:
  inspector review --repo <path> [options]

Options:
  --base-ref <ref>                 Base commit or branch (default: main)
  --format <markdown|json>         Report format (default: markdown)
  --max-output-tokens <number>     Maximum report budget (256-8000; default: 1800)
  --ai                             Opt in to external AI analysis
  --no-ai                          Disable external AI analysis (overrides environment)
  --validate <command>             Run one local command (60s; 16 KiB output limit)
  --help                           Show this help`;

function optionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new InspectionError(`${option} requires a value.`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: argv[0] ?? "",
    format: "markdown",
    help: argv.includes("--help"),
  };
  for (let index = 1; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--help") continue;
    if (token === "--ai") {
      args.aiEnabled = true;
      continue;
    }
    if (token === "--no-ai") {
      args.aiEnabled = false;
      continue;
    }
    const value = optionValue(argv, index, token);
    index++;
    switch (token) {
      case "--repo": args.repositoryPath = value; break;
      case "--base-ref": args.baseRef = value; break;
      case "--validate": args.validationCommand = value; break;
      case "--format":
        if (value !== "markdown" && value !== "json") {
          throw new InspectionError("--format must be markdown or json.");
        }
        args.format = value;
        break;
      case "--max-output-tokens": {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 256 || parsed > 8_000) {
          throw new InspectionError("--max-output-tokens must be an integer between 256 and 8000.");
        }
        args.maxOutputTokens = parsed;
        break;
      }
      default: throw new InspectionError(`Unknown option: ${token}`);
    }
  }
  return args;
}

function boundedValidationOutput(stdout: Buffer | null, stderr: Buffer | null): { text: string; truncated: boolean } {
  const combined = Buffer.concat([stdout ?? Buffer.alloc(0), stderr ?? Buffer.alloc(0)]);
  const truncated = combined.byteLength > VALIDATION_MAX_OUTPUT_BYTES;
  let text = combined.subarray(0, VALIDATION_MAX_OUTPUT_BYTES).toString("utf8");
  while (text.endsWith("\ufffd")) text = text.slice(0, -1);
  text = text.replace(/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "?").trim();
  return { text, truncated };
}

export function runValidationCommand(repositoryPath: string, command: string): ValidationResult {
  const result = spawnSync(command, {
    cwd: repositoryPath,
    shell: true,
    timeout: VALIDATION_TIMEOUT_MS,
    maxBuffer: VALIDATION_MAX_OUTPUT_BYTES + 1,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = boundedValidationOutput(
    Buffer.isBuffer(result.stdout) ? result.stdout : null,
    Buffer.isBuffer(result.stderr) ? result.stderr : null,
  );
  const errorCode = result.error instanceof Error && "code" in result.error ? result.error.code : undefined;
  const suffix = output.truncated || errorCode === "ENOBUFS" ? " (output truncated at 16 KiB)" : "";
  if (errorCode === "ETIMEDOUT") {
    return {
      name: "CLI validation",
      command,
      status: "failed",
      details: `Command timed out after 60 seconds${output.text ? `: ${output.text}` : "."}${suffix}`,
    };
  }
  const status = result.status === 0 ? "passed" : "failed";
  const defaultDetail = status === "passed" ? "Command completed successfully." : `Command exited with status ${result.status ?? "unknown"}.`;
  return { name: "CLI validation", command, status, details: `${output.text || defaultDetail}${suffix}` };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      console.log(USAGE);
      return 0;
    }
    if (args.command !== "review" || !args.repositoryPath) {
      console.error(USAGE);
      return 1;
    }

    const repositoryPath = resolveRepositoryPath(args.repositoryPath);
    const additionalValidation = args.validationCommand
      ? [runValidationCommand(repositoryPath, args.validationCommand)]
      : undefined;
    const result = await reviewRepository({
      repositoryPath,
      baseRef: args.baseRef,
      aiEnabled: args.aiEnabled ?? externalAiEnabledByEnvironment(),
      additionalValidation,
    }, {
      maxOutputTokens: args.maxOutputTokens,
    });
    const report = args.format === "json" ? jsonReport(result) : result.report;
    process.stdout.write(report);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Inspector error: ${message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
