import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../utils/spinner.js";
import { logger } from "../utils/logger.js";
import { fetchPullRequest } from "../services/prService.js";

export function registerPrCommand(program: Command): void {
  program
    .command("pr")
    .argument("<prNumber>", "Pull request number to inspect")
    .description("Inspect a pull request by number (placeholder: prints basic info).")
    .action(async (prNumberRaw: string) => {
      const prNumber = Number(prNumberRaw);
      if (!Number.isInteger(prNumber) || prNumber <= 0) {
        logger.error(`Invalid prNumber: ${chalk.bold(prNumberRaw)} (expected a positive integer)`);
        process.exitCode = 1;
        return;
      }

      logger.info(`PR requested for #${chalk.bold(String(prNumber))}`);
      const spinner = createSpinner(`Fetching PR #${prNumber}...`).start();

      try {
        const pr = await fetchPullRequest(prNumber);
        spinner.succeed(chalk.green("PR fetched"));
        logger.info(`${chalk.bold(pr.title)} (${chalk.gray(pr.url)})`);
      } catch (err: unknown) {
        spinner.fail(chalk.red("PR fetch failed"));
        logger.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

