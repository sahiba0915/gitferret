import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../utils/spinner.js";
import { logger } from "../utils/logger.js";
import { reviewFile } from "../services/reviewService.js";
import { formatAiReview } from "../utils/formatter.js";
import { ReviewError } from "../services/reviewErrors.js";

export function registerReviewCommand(program: Command): void {
  program
    .command("review")
    .argument("<file>", "File path to review")
    .option("--max-chars <n>", "Max characters to send to the AI (default: 12000)", (v) => Number(v))
    .description("Review a local file with AI and print a structured report.")
    .action(async (file: string, opts: { maxChars?: number }) => {
      logger.info(`Review requested for ${chalk.bold(file)}`);
      const spinner = createSpinner(`Reviewing ${file}...`).start();

      try {
        const result = await reviewFile(file, opts.maxChars === undefined ? {} : { maxChars: opts.maxChars });
        spinner.succeed(chalk.green("Review complete"));

        const headerBits = [
          chalk.bold("File:"),
          result.filePath,
          chalk.gray(`(${result.bytesRead.toLocaleString()} bytes${result.truncated ? `, truncated to ${result.maxChars.toLocaleString()} chars` : ""})`)
        ];
        console.log(headerBits.join(" "));
        console.log("");
        console.log(formatAiReview(result.aiRaw));
      } catch (err: unknown) {
        spinner.fail(chalk.red("Review failed"));
        if (err instanceof ReviewError) {
          logger.error(err.message);
          if (process.env.PRLENS_LOG_LEVEL === "debug" && err.details) {
            logger.debug(chalk.gray(err.details));
          }
        } else {
          logger.error(err instanceof Error ? err.message : String(err));
        }
        process.exitCode = 1;
      }
    });
}

