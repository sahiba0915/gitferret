import { Command } from "commander";
import chalk from "chalk";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSpinner } from "../utils/spinner.js";
import { CliError } from "../utils/cli.js";
import { ensureGitRepo } from "../services/git.service.js";

async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

function hookScript(): string {
  // A Node-based hook is the most portable approach across macOS/Linux/Windows git-bash.
  // In "dev-only" usage (running from a cloned repo), we prefer `node ./dist/index.js changes`.
  // If `dist/index.js` doesn't exist, we fall back to `npx gitferret changes` for published installs.
  return [
    "#!/usr/bin/env node",
    "/* Gitferret pre-push hook (generated). */",
    "import { spawnSync } from 'node:child_process';",
    "import { existsSync } from 'node:fs';",
    "",
    "const localEntry = './dist/index.js';",
    "const useLocal = existsSync(localEntry);",
    "",
    "let r;",
    "if (useLocal) {",
    "  r = spawnSync(process.execPath, [localEntry, 'changes'], { stdio: 'inherit' });",
    "} else {",
    "  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';",
    "  const args = ['-y', 'gitferret', 'changes'];",
    "  r = spawnSync(cmd, args, { stdio: 'inherit' });",
    "}",
    "process.exitCode = r.status ?? 1;",
    ""
  ].join("\n");
}

export function registerInstallCommand(program: Command): void {
  program
    .command("install")
    .description("Install a git pre-push hook that runs `gitferret changes` before pushing.")
    .option("--force", "Overwrite an existing pre-push hook")
    .addHelpText(
      "after",
      "\nExamples:\n  gitferret install\n  gitferret install --force\n\nWhat it does:\n  - Writes `.git/hooks/pre-push` to run `node ./dist/index.js changes` when available.\n  - Falls back to `npx -y gitferret changes` if `dist/` isn't present.\n"
    )
    .action(async (opts: { force?: boolean }) => {
      const spinner = createSpinner("Installing git pre-push hook...").start();
      try {
        await ensureGitRepo();

        const hooksDir = path.join(process.cwd(), ".git", "hooks");
        await mkdir(hooksDir, { recursive: true });
        const hookPath = path.join(hooksDir, "pre-push");

        if (!opts.force && (await fileExists(hookPath))) {
          const existing = await readFile(hookPath, "utf8").catch(() => "");
          const already = existing.includes("Gitferret pre-push hook") || existing.includes("gitferret changes");
          spinner.fail(chalk.yellow("Hook already exists"));
          if (already) {
            console.log(chalk.dim(`Existing hook already looks like Gitferret. If you want to rewrite it, run: gitferret install --force`));
          } else {
            console.log(chalk.dim(`A pre-push hook already exists at ${hookPath}. Use --force to overwrite.`));
          }
          process.exitCode = 1;
          return;
        }

        await writeFile(hookPath, hookScript(), { encoding: "utf8" });
        spinner.succeed(chalk.green("Installed pre-push hook"));
        console.log(chalk.dim(`Hook path: ${hookPath}`));
        console.log(chalk.dim("Next: run `gitferret changes` once to ensure your upstream branch is configured."));
      } catch (err: unknown) {
        spinner.fail(chalk.red("Install failed"));
        if (err instanceof CliError) throw err;
        throw new CliError("HOOK_INSTALL_FAILED", err instanceof Error ? err.message : String(err), undefined, err);
      }
    });
}

