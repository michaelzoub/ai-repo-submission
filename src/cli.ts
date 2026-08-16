#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { reviewRepository } from "./core.js";
import { InspectionError } from "./git.js";
import { jsonReport, markdownReport } from "./report.js";

export type CliArgs = {
  command: string;
  repositoryPath?: string;
  baseRef?: string;
  format: "markdown" | "json";
  outputPath?: string;
  validations: string[];
  validationTimeoutMs?: number;
  help: boolean;
};

const USAGE = `Usage:
  inspector review --repo <path> [options]

Options:
  --base-ref <ref>                 Base commit or branch (default: main)
  --format <markdown|json>         Report format (default: markdown)
  --output <path|->                Output file, or - for stdout
  --validate <command>             Run a shell command; repeatable (CLI only)
  --validation-timeout-ms <ms>     Per-command timeout (default: 120000)
  --help                           Show this help

Validation commands execute with the current user's privileges inside the repository.
Only run commands you trust.`;

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
    validations: [],
    help: argv.includes("--help"),
  };
  for (let index = 1; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--help") continue;
    const value = optionValue(argv, index, token);
    index++;
    switch (token) {
      case "--repo": args.repositoryPath = value; break;
      case "--base-ref": args.baseRef = value; break;
      case "--output": args.outputPath = value; break;
      case "--validate": args.validations.push(value); break;
      case "--format":
        if (value !== "markdown" && value !== "json") {
          throw new InspectionError("--format must be markdown or json.");
        }
        args.format = value;
        break;
      case "--validation-timeout-ms": {
        const timeout = Number(value);
        if (!Number.isInteger(timeout)) {
          throw new InspectionError("--validation-timeout-ms must be an integer.");
        }
        args.validationTimeoutMs = timeout;
        break;
      }
      default: throw new InspectionError(`Unknown option: ${token}`);
    }
  }
  return args;
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

    const result = await reviewRepository(
      {
        repositoryPath: args.repositoryPath,
        baseRef: args.baseRef,
        validationCommands: args.validations,
        validationTimeoutMs: args.validationTimeoutMs,
      },
      { allowValidation: true },
    );
    const report = args.format === "json" ? jsonReport(result) : markdownReport(result);
    const outputPath = args.outputPath ?? (args.format === "json" ? "review-report.json" : "review-report.md");
    if (outputPath === "-") {
      process.stdout.write(report);
    } else {
      await writeFile(outputPath, report, "utf8");
      console.log(`Review report written to ${outputPath}`);
    }
    return result.validationResults.some((validation) => validation.status !== "passed") ? 2 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Inspector error: ${message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
