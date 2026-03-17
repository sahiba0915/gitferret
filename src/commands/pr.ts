import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../utils/spinner.js";
import { logger } from "../utils/logger.js";
import { reviewPullRequest, PrReviewError } from "../services/prReviewService.js";
import { formatStructuredReview, parseNumberedHeadings } from "../utils/structuredReview.js";

export function registerPrCommand(program: Command): void {
  program
    .command("pr")
    .argument("<prNumber>", "Pull request number to inspect")
    .requiredOption("--repo <owner/repo>", "GitHub repository (e.g. vercel/next.js)")
    .option("--max-chars <n>", "Max characters of minimized diff to send (default: 12000)", (v) => Number(v))
    .description("Fetch PR diff from GitHub, extract only changed lines, and generate a structured AI review.")
    .action(async (prNumberRaw: string, opts: { repo: string; maxChars?: number }) => {
      logger.info(
        `PR review requested for ${chalk.bold(opts.repo)}#${chalk.bold(prNumberRaw)}`
      );
      const spinner = createSpinner("Fetching PR diff and generating review...").start();

      try {
        const result = await reviewPullRequest(opts.repo, prNumberRaw, opts.maxChars === undefined ? {} : { maxChars: opts.maxChars });
        spinner.succeed(chalk.green("Review complete"));

        const metaBits = [
          chalk.bold("PR:"),
          `${result.repo.owner}/${result.repo.repo}#${result.pr.number}`,
          chalk.bold(result.pr.title),
          chalk.gray(`(${result.pr.htmlUrl})`)
        ];
        console.log(metaBits.join(" "));
        console.log(
          chalk.gray(
            `Diff: ${result.diffChars.toLocaleString()} chars, minimized: ${result.minimizedDiffChars.toLocaleString()} chars` +
              (result.truncated ? `, sent: ${result.maxChars.toLocaleString()} chars (truncated)` : "")
          )
        );
        if (result.changedFiles.length > 0) {
          console.log(chalk.bold("Files changed:"));
          for (const f of result.changedFiles) console.log(`- ${f}`);
        }
        console.log("");

        const parsed = parseNumberedHeadings(result.aiRaw);
        console.log(formatStructuredReview(parsed));
      } catch (err: unknown) {
        spinner.fail(chalk.red("PR review failed"));
        if (err instanceof PrReviewError) {
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

