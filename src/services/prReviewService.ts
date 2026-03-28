import { analyze, buildPRReviewPrompt, LlmApiError } from "./ai.service.js";
import { GitHubApiError, GitHubClient, parseRepoRef, type GitHubRepoRef, type PullRequest } from "./github.service.js";
import { parseUnifiedDiff, toMinimizedDiff, truncateToChars } from "../utils/diff.js";

export type ReviewPullRequestOptions = {
  maxChars?: number;
  github?: { token?: string; baseUrl?: string; timeoutMs?: number };
};

export type ReviewedPullRequest = {
  repo: GitHubRepoRef;
  pr: PullRequest;
  changedFiles: string[];
  diffChars: number;
  minimizedDiffChars: number;
  truncated: boolean;
  maxChars: number;
  minimizedDiff: string;
  aiRaw: string;
};

export class PrReviewError extends Error {
  readonly code:
    | "INVALID_REPO"
    | "INVALID_PR_NUMBER"
    | "GITHUB_AUTH_MISSING"
    | "GITHUB_FAILED"
    | "DIFF_EMPTY"
    | "AI_FAILED";
  readonly details: string | undefined;

  constructor(
    code: PrReviewError["code"],
    message: string,
    details?: string,
    cause?: unknown
  ) {
    super(message);
    this.name = "PrReviewError";
    this.code = code;
    this.details = details;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

function normalizeMaxChars(input: number | undefined): number {
  const n = input ?? 12_000;
  // Allow very small values for troubleshooting provider limits.
  if (!Number.isFinite(n) || n <= 0) return 12_000;
  return Math.floor(n);
}

export function parsePrNumber(prNumberRaw: string): number {
  const n = Number(prNumberRaw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new PrReviewError("INVALID_PR_NUMBER", `Invalid prNumber: ${prNumberRaw} (expected a positive integer)`);
  }
  return n;
}

export function parseRepoOrThrow(repoRaw: string): GitHubRepoRef {
  try {
    return parseRepoRef(repoRaw);
  } catch (err: unknown) {
    if (err instanceof GitHubApiError) {
      throw new PrReviewError("INVALID_REPO", err.message, err.details, err);
    }
    throw new PrReviewError("INVALID_REPO", err instanceof Error ? err.message : String(err), undefined, err);
  }
}

async function fetchPrAndDiff(client: GitHubClient, repo: GitHubRepoRef, prNumber: number): Promise<{ pr: PullRequest; diff: string }> {
  try {
    const [pr, diff] = await Promise.all([
      client.fetchPullRequest(repo, prNumber),
      client.fetchPullRequestDiff(repo, prNumber)
    ]);
    return { pr, diff };
  } catch (err: unknown) {
    if (err instanceof GitHubApiError) {
      const missingTokenHint =
        (err.status === 401 || err.status === 403) && !process.env.GITFERRET_GITHUB_TOKEN && !process.env.GITHUB_TOKEN;
      if (missingTokenHint) {
        throw new PrReviewError(
          "GITHUB_AUTH_MISSING",
          "Missing GitHub token. Set GITFERRET_GITHUB_TOKEN (preferred) or GITHUB_TOKEN.",
          err.details,
          err
        );
      }
      throw new PrReviewError("GITHUB_FAILED", err.message, err.details, err);
    }
    throw new PrReviewError("GITHUB_FAILED", err instanceof Error ? err.message : String(err), undefined, err);
  }
}

function minimizeDiff(diff: string): { minimized: string; minimizedChars: number; changedFiles: string[] } {
  const files = parseUnifiedDiff(diff);
  const changedFiles = files
    .map((f) => f.newPath ?? f.oldPath ?? "(unknown file)")
    .filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);
  const minimized = toMinimizedDiff(files).trim();
  return { minimized, minimizedChars: minimized.length, changedFiles };
}

async function analyzeDiff(minimizedDiff: string): Promise<string> {
  const prompt = buildPRReviewPrompt(minimizedDiff);
  try {
    return await analyze(prompt);
  } catch (err: unknown) {
    if (err instanceof LlmApiError) {
      throw new PrReviewError("AI_FAILED", err.message, err.details, err);
    }
    throw new PrReviewError("AI_FAILED", err instanceof Error ? err.message : String(err), undefined, err);
  }
}

export async function reviewPullRequest(
  repoRaw: string,
  prNumberRaw: string,
  options: ReviewPullRequestOptions = {}
): Promise<ReviewedPullRequest> {
  const repo = parseRepoOrThrow(repoRaw);
  const prNumber = parsePrNumber(prNumberRaw);
  const maxChars = normalizeMaxChars(options.maxChars);

  const client = new GitHubClient(options.github);
  const { pr, diff } = await fetchPrAndDiff(client, repo, prNumber);

  const { minimized, minimizedChars, changedFiles } = minimizeDiff(diff);
  if (!minimized) {
    throw new PrReviewError("DIFF_EMPTY", "PR diff was empty or contained no textual hunks to review.");
  }

  const truncated = truncateToChars(minimized, maxChars);
  const minimizedForAi = truncated.truncated
    ? `${truncated.text}\n\n[Note: diff was truncated to ${maxChars.toLocaleString()} characters for analysis.]`
    : truncated.text;

  const aiRaw = await analyzeDiff(minimizedForAi);
  return {
    repo,
    pr,
    changedFiles,
    diffChars: diff.length,
    minimizedDiffChars: minimizedChars,
    truncated: truncated.truncated,
    maxChars,
    minimizedDiff: truncated.text,
    aiRaw
  };
}

