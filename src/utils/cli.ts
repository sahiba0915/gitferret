import chalk from "chalk";
import { CommanderError, InvalidArgumentError } from "commander";
import { ReviewError } from "../services/reviewErrors.js";
import { PrReviewError } from "../services/prReviewService.js";

export type CliErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_A_GIT_REPO"
  | "GIT_NOT_FOUND"
  | "GIT_FAILED"
  | "UPSTREAM_NOT_SET"
  | "HOOK_INSTALL_FAILED";

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly details: string | undefined;
  constructor(code: CliErrorCode, message: string, details?: string, cause?: unknown) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.details = details;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export function parsePositiveIntArg(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new InvalidArgumentError(`${name} must be a positive integer (got: ${raw})`);
  }
  return n;
}

export function parsePositiveIntOption(raw: string): number {
  return parsePositiveIntArg("value", raw);
}

export function parseRepoRefArg(raw: string): string {
  // Keep validation lightweight here; deeper validation happens in the GitHub client.
  if (!/^[^/\s]+\/[^/\s]+$/.test(raw)) {
    throw new InvalidArgumentError(`repo must be in "owner/repo" format (got: ${raw})`);
  }
  return raw;
}

export function formatUserFacingError(err: unknown): { title: string; hint?: string; details?: string } {
  if (err instanceof CommanderError) {
    // Examples: unknown command/option, missing required option, etc.
    // InvalidArgumentError extends CommanderError but is handled separately below.
    const hint =
      err.code === "commander.unknownCommand"
        ? "Run `gitferret --help` to see available commands."
        : err.code === "commander.unknownOption"
          ? "Run with `--help` to see valid options."
          : err.code === "commander.missingMandatoryOptionValue" || err.code === "commander.optionMissingArgument"
            ? "Check the option value and try again."
            : err.code === "commander.missingRequiredArgument"
              ? "Check required arguments and try again."
              : undefined;
    return { title: err.message.replace(/^error:\s*/i, ""), ...(hint ? { hint } : {}) };
  }

  if (err instanceof InvalidArgumentError) {
    return { title: err.message, hint: "Run with `--help` to see valid usage." };
  }

  if (err instanceof CliError) {
    const hint =
      err.code === "UPSTREAM_NOT_SET"
        ? "Set an upstream branch first, e.g. `git branch --set-upstream-to origin/main`."
        : err.code === "NOT_A_GIT_REPO"
          ? "Run this from inside a git repository."
          : err.code === "GIT_NOT_FOUND"
            ? "Install git and ensure it is on your PATH."
            : undefined;
    return {
      title: err.message,
      ...(hint ? { hint } : {}),
      ...(err.details ? { details: err.details } : {})
    };
  }

  if (err instanceof PrReviewError) {
    const hint =
      err.code === "GITHUB_AUTH_MISSING"
        ? "Set `GITFERRET_GITHUB_TOKEN` (recommended) or `GITHUB_TOKEN`."
        : err.code === "INVALID_REPO"
          ? "Example: `--repo vercel/next.js`"
          : err.code === "INVALID_PR_NUMBER"
            ? "Example: `gitferret pr 123 --repo owner/repo`"
            : undefined;
    return {
      title: err.message,
      ...(hint ? { hint } : {}),
      ...(err.details ? { details: err.details } : {})
    };
  }

  if (err instanceof ReviewError) {
    const hint =
      err.code === "FILE_NOT_FOUND"
        ? "Check the path, or run from the repo root."
        : err.code === "PERMISSION_DENIED"
          ? "Check file permissions."
          : err.code === "AI_FAILED"
            ? "Verify your LLM env vars (see README) and try again."
            : undefined;
    return {
      title: err.message,
      ...(hint ? { hint } : {}),
      ...(err.details ? { details: err.details } : {})
    };
  }

  if (err instanceof Error) return { title: err.message };
  return { title: String(err) };
}

export function printUserFacingError(err: unknown): void {
  const { title, hint, details } = formatUserFacingError(err);
  // Keep output compact and friendly (similar to popular CLIs).
  console.error(chalk.red("Error:"), title);
  if (hint) console.error(chalk.dim("Hint:"), hint);
  if (process.env.GITFERRET_LOG_LEVEL === "debug" && details) {
    console.error(chalk.dim(details));
  }
}

