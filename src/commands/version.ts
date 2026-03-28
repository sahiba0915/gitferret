import { Command } from "commander";
import { createRequire } from "node:module";

export function registerVersionCommand(program: Command): void {
  program
    .command("version")
    .description("Print the installed Gitferret version.")
    .addHelpText(
      "after",
      "\nExamples:\n  gitferret version\n  gitferret -V\n"
    )
    .action(() => {
      const require = createRequire(import.meta.url);
      const pkg = require("../../package.json") as { version?: string; name?: string };
      const name = pkg.name ?? "gitferret";
      const version = pkg.version ?? "0.0.0";
      // Standard CLI output: `<name> <version>`
      console.log(`${name} ${version}`);
    });
}

