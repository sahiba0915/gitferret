import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../utils/spinner.js";
import { logger } from "../utils/logger.js";
import { reviewFile } from "../services/reviewService.js";

export function registerReviewCommand(program: Command): void {
  program
    .command("review")
    .argument("<file>", "File path to review")
    .description("Review a local file (placeholder: prints basic info).")
    .action(async (file: string) => {
      logger.info(`Review requested for ${chalk.bold(file)}`);
      const spinner = createSpinner(`Reviewing ${file}...`).start();

      try {
        const result = await reviewFile(file);
        spinner.succeed(chalk.green("Review complete"));
        logger.info(result.summary);
      } catch (err: unknown) {
        spinner.fail(chalk.red("Review failed"));
        logger.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

