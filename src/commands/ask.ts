import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../utils/spinner.js";
import { logger } from "../utils/logger.js";
import { askQuestion } from "../services/askService.js";

export function registerAskCommand(program: Command): void {
  program
    .command("ask")
    .argument("<question>", "Question to ask about the codebase")
    .description("Ask a question (placeholder: echoes the question).")
    .action(async (question: string) => {
      logger.info(`Question received: ${chalk.bold(question)}`);
      const spinner = createSpinner("Thinking...").start();

      try {
        const answer = await askQuestion(question);
        spinner.succeed(chalk.green("Answer ready"));
        logger.info(answer);
      } catch (err: unknown) {
        spinner.fail(chalk.red("Ask failed"));
        logger.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

