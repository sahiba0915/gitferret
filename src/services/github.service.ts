export type GitHubRepoRef = {
  owner: string;
  repo: string;
};

export type PullRequest = {
  number: number;
  title: string;
  htmlUrl: string;
  state: string;
  draft: boolean;
  userLogin: string | null;
  baseRef: string;
  headRef: string;
};

export type GitHubClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  token?: string;
};

type HttpResult = { res: Response; text: string };

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/g, "");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getEnvFirst(...names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

async function fetchTextWithTimeout(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<HttpResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(timeout);
  }
}

function safeJsonParse<T>(text: string): T | undefined {
  try {
    return text ? (JSON.parse(text) as T) : undefined;
  } catch {
    return undefined;
  }
}

function parseGitHubMessage(text: string): string | undefined {
  const data = safeJsonParse<{ message?: string }>(text);
  const msg = data?.message?.trim();
  return msg ? msg : undefined;
}

export class GitHubApiError extends Error {
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly documentationUrl: string | undefined;
  readonly details: string | undefined;

  constructor(args: {
    message: string;
    status?: number;
    requestId?: string;
    documentationUrl?: string;
    details?: string;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "GitHubApiError";
    this.status = args.status;
    this.requestId = args.requestId;
    this.documentationUrl = args.documentationUrl;
    this.details = args.details;
    if (args.cause !== undefined) (this as { cause?: unknown }).cause = args.cause;
  }
}

export function parseRepoRef(input: string): GitHubRepoRef {
  const raw = (input ?? "").trim();
  const m = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m) {
    throw new GitHubApiError({
      message: `Invalid repo "${input}". Expected "owner/repo".`
    });
  }
  return { owner: m[1]!, repo: m[2]! };
}

export class GitHubClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly token: string | undefined;

  constructor(options: GitHubClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? getEnvFirst("PRLENS_GITHUB_BASE_URL") ?? "https://api.github.com");
    this.timeoutMs = options.timeoutMs ?? parsePositiveInt(getEnvFirst("PRLENS_GITHUB_TIMEOUT_MS"), 20_000);
    this.token = options.token ?? getEnvFirst("PRLENS_GITHUB_TOKEN", "GITHUB_TOKEN");
  }

  private buildHeaders(accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      "User-Agent": "prlens",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  private async getText(path: string, accept: string): Promise<HttpResult> {
    const url = `${this.baseUrl}${path}`;
    try {
      return await fetchTextWithTimeout(
        url,
        {
          method: "GET",
          headers: this.buildHeaders(accept)
        },
        this.timeoutMs
      );
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new GitHubApiError({ message: `GitHub request timed out after ${this.timeoutMs}ms.`, cause: err });
      }
      throw new GitHubApiError({ message: err instanceof Error ? err.message : String(err), cause: err });
    }
  }

  private toApiError(res: Response, text: string): GitHubApiError {
    const msg = parseGitHubMessage(text);
    const requestId = res.headers.get("x-github-request-id") ?? undefined;
    const docUrl = safeJsonParse<{ documentation_url?: string }>(text)?.documentation_url;
    const base = msg ?? (text ? text.slice(0, 500) : "Request failed");
    const authHint =
      res.status === 401
        ? "Check PRLENS_GITHUB_TOKEN / GITHUB_TOKEN."
        : res.status === 403
          ? "This may be rate limiting or missing permissions."
          : "";
    const rateLimitHint = (() => {
      if (res.status !== 403) return "";
      const remaining = res.headers.get("x-ratelimit-remaining");
      const reset = res.headers.get("x-ratelimit-reset");
      if (remaining === "0" && reset) {
        const resetMs = Number(reset) * 1000;
        if (Number.isFinite(resetMs)) {
          const inMin = Math.max(0, Math.round((resetMs - Date.now()) / 60000));
          return ` Rate limit exceeded; try again in ~${inMin} min.`;
        }
      }
      return "";
    })();
    const notFoundHint =
      res.status === 404 ? " Check that the repo exists and the PR number is valid." : "";
    return new GitHubApiError({
      status: res.status,
      message: `GitHub API error (${res.status}): ${base}${notFoundHint}${authHint ? ` ${authHint}` : ""}${rateLimitHint}`,
      ...(requestId ? { requestId } : {}),
      ...(docUrl ? { documentationUrl: docUrl } : {}),
      ...(text ? { details: text } : {})
    });
  }

  async fetchPullRequest(repo: GitHubRepoRef, prNumber: number): Promise<PullRequest> {
    const { res, text } = await this.getText(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${prNumber}`,
      "application/vnd.github+json"
    );
    if (!res.ok) throw this.toApiError(res, text);

    const data = safeJsonParse<{
      number?: number;
      title?: string;
      html_url?: string;
      state?: string;
      draft?: boolean;
      user?: { login?: string | null } | null;
      base?: { ref?: string } | null;
      head?: { ref?: string } | null;
    }>(text);

    const number = data?.number;
    const title = data?.title;
    const htmlUrl = data?.html_url;
    if (!number || !title || !htmlUrl) {
      throw new GitHubApiError({
        status: res.status,
        message: "GitHub returned an unexpected PR payload.",
        details: text
      });
    }

    return {
      number,
      title,
      htmlUrl,
      state: data?.state ?? "unknown",
      draft: Boolean(data?.draft),
      userLogin: data?.user?.login ?? null,
      baseRef: data?.base?.ref ?? "",
      headRef: data?.head?.ref ?? ""
    };
  }

  async fetchPullRequestDiff(repo: GitHubRepoRef, prNumber: number): Promise<string> {
    const { res, text } = await this.getText(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${prNumber}`,
      "application/vnd.github.v3.diff"
    );
    if (!res.ok) throw this.toApiError(res, text);
    return text;
  }
}

