import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../utils/spinner.js";
import { logger } from "../utils/logger.js";
import { unifiedDiffAgainstUpstream } from "../services/git.service.js";
import { parseUnifiedDiff, toMinimizedDiff, truncateToChars } from "../utils/diff.js";
import { analyze, buildPRReviewPrompt, LlmApiError } from "../services/ai.service.js";
import { formatAiReview } from "../utils/formatter.js";
import { parsePositiveIntOption } from "../utils/cli.js";

export function registerChangesCommand(program: Command): void {
  program
    .command("changes")
    .description("Review local changes vs upstream (git diff @{u}...HEAD) using minimized diff.")
    .option("--max-chars <n>", "Max characters of minimized diff to send (default: 12000)", parsePositiveIntOption)
    .addHelpText(
      "after",
      "\nExamples:\n  prlens changes\n  prlens changes --max-chars 8000\n\nNotes:\n  - Requires an upstream branch (e.g. origin/main).\n  - Uses `git diff --unified=0 @{u}...HEAD` under the hood.\n"
    )
    .action(async (opts: { maxChars?: number }) => {
      const spinner = createSpinner("Collecting git diff and generating review...").start();
      try {
        const maxChars = opts.maxChars ?? 12_000;
        const diff = await unifiedDiffAgainstUpstream();
        const files = parseUnifiedDiff(diff);
        const minimized = toMinimizedDiff(files).trim();
        if (!minimized) {
          spinner.fail(chalk.yellow("No textual changes detected"));
          logger.info("No textual hunks to review in `git diff @{u}...HEAD`.");
          return;
        }

        const { text, truncated } = truncateToChars(minimized, maxChars);
        const minimizedForAi = truncated
          ? `${text}\n\n[Note: diff was truncated to ${maxChars.toLocaleString()} characters for analysis.]`
          : text;

        const prompt = buildPRReviewPrompt(minimizedForAi);
        const aiRaw = await analyze(prompt);
        spinner.succeed(chalk.green("Review complete"));

        const changedFiles = files
          .map((f) => f.newPath ?? f.oldPath ?? "(unknown file)")
          .filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

        if (changedFiles.length) {
          console.log(chalk.bold("Files changed:"));
          for (const f of changedFiles) console.log(`- ${f}`);
          console.log("");
        }

        console.log(formatAiReview(aiRaw));
      } catch (err: unknown) {
        spinner.fail(chalk.red("Review failed"));
        if (err instanceof LlmApiError && err.retryAfterMs !== undefined) {
          logger.error(`${err.message} Retry after ${Math.ceil(err.retryAfterMs / 1000)}s.`);
        } else {
          throw err;
        }
        process.exitCode = 1;
      }
    });
}

