#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { loadEnv } from "./config/env.js";
import { loadConfig } from "./config/prlensConfig.js";
import { registerAskCommand } from "./commands/ask.js";
import { registerPrCommand } from "./commands/pr.js";
import { registerReviewCommand } from "./commands/review.js";
import { logger } from "./utils/logger.js";
import { printUserFacingError } from "./utils/cli.js";
import { registerVersionCommand } from "./commands/version.js";
import { registerChangesCommand } from "./commands/changes.js";
import { registerInstallCommand } from "./commands/install.js";

loadEnv();
await loadConfig();

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version?: string };

const program = new Command()
  .name("prlens")
  .description("PRLens - review diffs, inspect PRs, and ask questions about your codebase.")
  .version(pkg.version ?? "0.0.0")
  .addHelpText(
    "after",
    "\nExamples:\n  prlens review README.md\n  prlens pr 123 --repo vercel/next.js\n  prlens changes\n  prlens ask \"Where is config loaded?\"\n  prlens version\n"
  );

registerReviewCommand(program);
registerPrCommand(program);
registerAskCommand(program);
registerChangesCommand(program);
registerInstallCommand(program);
registerVersionCommand(program);

program.configureHelp({
  sortSubcommands: true,
  sortOptions: true
});

// Commander prints its own "error: ..." lines. We override stderr output so we can
// present consistent, friendly errors from a single place.
const silenceCommanderErrOutput = (cmd: Command) => {
  cmd.configureOutput({ writeErr: () => {} });
  cmd.exitOverride();
  for (const sub of cmd.commands) silenceCommanderErrOutput(sub);
};
silenceCommanderErrOutput(program);

program.showHelpAfterError(true);
program.showSuggestionAfterError(true);

program.parseAsync(process.argv).catch((err: unknown) => {
  printUserFacingError(err);
  // Still log the raw message for users piping logs via PRLENS_LOG_LEVEL=debug.
  logger.debug(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});

