import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CliError } from "../utils/cli.js";

const execFileAsync = promisify(execFile);

type ExecResult = { stdout: string; stderr: string };

function toExecError(err: unknown): { message: string; code?: string; stderr?: string } {
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: string; stderr?: string };
    return {
      message: err.message,
      ...(anyErr.code ? { code: anyErr.code } : {}),
      ...(anyErr.stderr ? { stderr: anyErr.stderr } : {})
    };
  }
  return { message: String(err) };
}

export async function git(args: string[], options?: { cwd?: string }): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: options?.cwd,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    return { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
  } catch (err: unknown) {
    const e = toExecError(err);
    if (e.code === "ENOENT") {
      throw new CliError("GIT_NOT_FOUND", "git was not found on PATH.", e.stderr, err);
    }
    throw new CliError("GIT_FAILED", `git ${args.join(" ")} failed.`, e.stderr ?? e.message, err);
  }
}

export async function ensureGitRepo(): Promise<void> {
  const { stdout } = await git(["rev-parse", "--is-inside-work-tree"]);
  if (stdout.trim() !== "true") throw new CliError("NOT_A_GIT_REPO", "Not inside a git repository.");
}

export async function currentBranchUpstreamRef(): Promise<string> {
  try {
    const { stdout } = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    const ref = stdout.trim();
    if (!ref) throw new CliError("UPSTREAM_NOT_SET", "No upstream branch is configured for the current branch.");
    return ref;
  } catch (err: unknown) {
    if (err instanceof CliError && err.code === "GIT_FAILED") {
      // git throws when upstream isn't set; map it to a more helpful message.
      throw new CliError("UPSTREAM_NOT_SET", "No upstream branch is configured for the current branch.", err.details, err);
    }
    throw err;
  }
}

export async function unifiedDiffAgainstUpstream(): Promise<string> {
  await ensureGitRepo();
  await currentBranchUpstreamRef();
  // --unified=0 makes diffs closer to PR-style hunks and reduces tokens.
  const { stdout } = await git(["diff", "--unified=0", "@{u}...HEAD"]);
  return stdout;
}

