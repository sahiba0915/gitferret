export type PullRequestInfo = {
  number: number;
  title: string;
  url: string;
};

export async function fetchPullRequest(prNumber: number): Promise<PullRequestInfo> {
  // Placeholder: later this can integrate with GitHub API.
  return {
    number: prNumber,
    title: `Pull Request #${prNumber}`,
    url: `https://example.com/pull/${prNumber}`
  };
}

