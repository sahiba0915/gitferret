import { Command } from "commander";
import { createRequire } from "node:module";

export function registerVersionCommand(program: Command): void {
  program
    .command("version")
    .description("Print the installed PRLens version.")
    .addHelpText(
      "after",
      "\nExamples:\n  prlens version\n  prlens -V\n"
    )
    .action(() => {
      const require = createRequire(import.meta.url);
      const pkg = require("../../package.json") as { version?: string; name?: string };
      const name = pkg.name ?? "prlens";
      const version = pkg.version ?? "0.0.0";
      // Standard CLI output: `<name> <version>`
      console.log(`${name} ${version}`);
    });
}

