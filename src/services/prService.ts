/**
 * Deprecated: use `reviewPullRequest` (GitHub-backed) instead.
 *
 * Kept temporarily for backwards compatibility with any external imports.
 */
export type PullRequestInfo = {
  number: number;
  title: string;
  url: string;
};

export async function fetchPullRequest(prNumber: number): Promise<PullRequestInfo> {
  return {
    number: prNumber,
    title: `Pull Request #${prNumber}`,
    url: `https://github.com`
  };
}

