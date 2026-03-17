import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../utils/spinner.js";
import { logger } from "../utils/logger.js";
import { askQuestion } from "../services/askService.js";

export function registerAskCommand(program: Command): void {
  program
    .command("ask")
    .argument("<question>", "Question to ask about the codebase")
    .description("Ask a question about the local codebase (reads a limited set of files for context).")
    .addHelpText(
      "after",
      "\nExamples:\n  prlens ask \"How does auth work?\"\n  prlens ask \"Where is the database client created?\"\n"
    )
    .action(async (question: string) => {
      logger.info(`Question: ${chalk.bold(question)}`);
      const spinner = createSpinner("Thinking...").start();

      try {
        const result = await askQuestion(question);
        spinner.succeed(chalk.green("Answer ready"));
        logger.info(result.answer.trim());
        if (result.includedFiles.length) {
          logger.info("");
          logger.info(chalk.dim(`Context files (${result.includedFiles.length}):`));
          for (const f of result.includedFiles) logger.info(chalk.dim(`- ${f}`));
        }
      } catch (err: unknown) {
        spinner.fail(chalk.red("Ask failed"));
        logger.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

