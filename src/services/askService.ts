import { analyze, LlmApiError } from "./ai.service.js";
import { buildRepoContext, type RepoContextOptions } from "../utils/repoContext.js";
import { ReviewError } from "./reviewErrors.js";

export type AskOptions = {
  context?: RepoContextOptions;
};

export type AskResult = {
  answer: string;
  includedFiles: string[];
  scannedFiles: number;
  truncatedFiles: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAskPrompt(context: string, question: string, includedFiles: string[]): string {
  const fileList = includedFiles.length ? includedFiles.map((f) => `- ${f}`).join("\n") : "(none)";
  return [
    "You are a senior software engineer.",
    "Answer the user's question using only the provided repository context.",
    "Be concise and direct.",
    "When you make a claim tied to code, cite the relevant file path(s) from the included files list.",
    "If context is insufficient, say what's missing and which files would likely contain it.",
    "",
    "Included files:",
    fileList,
    "",
    "Context:",
    "```",
    context.trim(),
    "```",
    "",
    "Question:",
    question.trim()
  ].join("\n");
}

export async function askQuestion(question: string, options: AskOptions = {}): Promise<AskResult> {
  const repo = await buildRepoContext(question, options.context);
  if (!repo.context.trim()) {
    throw new ReviewError(
      "FILE_READ_FAILED",
      "No repository context could be built (no matching files found or all files were excluded)."
    );
  }

  const prompt = buildAskPrompt(repo.context, question, repo.includedFiles);
  try {
    let answer: string;
    try {
      answer = await analyze(prompt);
    } catch (err: unknown) {
      // If the provider indicates rate limiting with a Retry-After, wait once and retry.
      if (err instanceof LlmApiError && err.retryAfterMs !== undefined) {
        const waitMs = Math.max(0, Math.min(err.retryAfterMs, 30_000));
        if (waitMs > 0) await sleep(waitMs);
        answer = await analyze(prompt);
      } else {
        throw err;
      }
    }
    return {
      answer,
      includedFiles: repo.includedFiles,
      scannedFiles: repo.scannedFiles,
      truncatedFiles: repo.truncatedFiles
    };
  } catch (err: unknown) {
    if (err instanceof LlmApiError) {
      throw new ReviewError("AI_FAILED", err.message, err.details, err);
    }
    throw new ReviewError("AI_FAILED", err instanceof Error ? err.message : String(err), undefined, err);
  }
}

