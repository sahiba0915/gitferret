#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { loadEnv } from "./config/env.js";
import { registerAskCommand } from "./commands/ask.js";
import { registerPrCommand } from "./commands/pr.js";
import { registerReviewCommand } from "./commands/review.js";
import { logger } from "./utils/logger.js";

loadEnv();

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version?: string };

const program = new Command()
  .name("prlens")
  .description("PRLens - review diffs, inspect PRs, and ask questions about your codebase.")
  .version(pkg.version ?? "0.0.0");

registerReviewCommand(program);
registerPrCommand(program);
registerAskCommand(program);

program.configureHelp({
  sortSubcommands: true,
  sortOptions: true
});

program.showHelpAfterError(true);
program.showSuggestionAfterError(true);

program.parseAsync(process.argv).catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

