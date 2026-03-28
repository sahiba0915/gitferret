# Gitferret

Gitferret is a developer-friendly CLI for getting **fast, structured AI reviews** of:

- Local files (`gitferret review`)
- GitHub PR diffs (`gitferret pr`)
- Your local branch changes vs upstream (`gitferret changes`)
- Questions about your codebase (`gitferret ask`)

It minimizes diffs (keeps only changed lines) to reduce tokens and keep reviews focused.

## Install

### From npm (recommended)

```bash
npm i -g gitferret
gitferret --help
```

Or run without installing globally:

```bash
npx gitferret --help
```

## Quick start

```bash
gitferret review README.md
gitferret pr 123 --repo vercel/next.js
gitferret changes
gitferret ask "Where is config loaded?"
gitferret version
```

## How to use

### Set env (required for AI)

Pick one LLM provider and set its key (details are in this README under **LLM Provider**). Example (OpenAI-compatible):

```bash
export GITFERRET_LLM_PROVIDER=openai-compatible
export GITFERRET_LLM_BASE_URL=https://api.openai.com
export GITFERRET_LLM_API_KEY=...
export GITFERRET_LLM_MODEL=gpt-4o-mini
```

If you want `gitferret pr`, also set:

```bash
export GITFERRET_GITHUB_TOKEN=...
```

### Run commands

#### Review a file

```bash
gitferret review README.md
```

#### Review a GitHub PR

```bash
gitferret pr 123 --repo vercel/next.js
```

#### Review local branch changes vs upstream

```bash
gitferret changes
```

#### Ask a question about the repo

```bash
gitferret ask "Where is config loaded?"
```

#### Print version

```bash
gitferret version
```

### Optional: run before every push

Inside a git repo:

```bash
gitferret install
```

That installs a `pre-push` hook that runs `gitferret changes` before pushing.

## Commands

### `review <file>`

Review a local file and print a structured report.

```bash
gitferret review src/index.ts
gitferret review src/index.ts --max-chars 8000
```

### `pr <number> --repo <owner/repo>`

Fetch the PR diff from GitHub, minimize it, then generate a structured AI review.

```bash
gitferret pr 123 --repo vercel/next.js
gitferret pr 123 --repo owner/repo --max-chars 8000
```

### `changes`

Review your local changes vs the configured upstream branch.

Under the hood it runs:

```bash
git diff --unified=0 @{u}...HEAD
```

Examples:

```bash
gitferret changes
gitferret changes --max-chars 8000
```

If you don’t have an upstream branch set, configure one (example):

```bash
git branch --set-upstream-to origin/main
```

### `ask "<question>"`

Ask a question about your local codebase (Gitferret scans a limited subset of files for context).

```bash
gitferret ask "How does auth work?"
gitferret ask "Where is the database client created?"
```

### `install` (optional)

Installs a git `pre-push` hook that runs `gitferret changes` before pushing.

```bash
gitferret install
gitferret install --force
```

This writes `.git/hooks/pre-push` to run:

```bash
node ./dist/index.js changes
```

## Configuration

### Logging

- `GITFERRET_LOG_LEVEL`: `debug` | `info` | `warn` | `error` (default: `info`)

### GitHub (for `gitferret pr`)

- `GITFERRET_GITHUB_TOKEN` (recommended) or `GITHUB_TOKEN`

### LLM Provider (required for AI)

Gitferret supports multiple providers. Pick one.

#### OpenAI / OpenAI-compatible (default)

```bash
export GITFERRET_LLM_PROVIDER=openai-compatible
export GITFERRET_LLM_BASE_URL=https://api.openai.com
export GITFERRET_LLM_API_KEY=...
export GITFERRET_LLM_MODEL=gpt-4o-mini
```

Back-compat env vars also work: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`.

#### Gemini

```bash
export GITFERRET_LLM_PROVIDER=gemini
export GITFERRET_LLM_API_KEY=...
export GITFERRET_LLM_MODEL=gemini-2.0-flash
```

#### Anthropic

```bash
export GITFERRET_LLM_PROVIDER=anthropic
export GITFERRET_LLM_API_KEY=...
export GITFERRET_LLM_MODEL=claude-3-5-sonnet-latest
```

## Privacy & security notes

- Gitferret sends the content it is reviewing (files/diffs and related context) to the configured LLM provider.
- **Do not** run it on proprietary code if you’re not allowed to share that code with your chosen provider.
- API keys/tokens are read from environment variables (for example `GITFERRET_LLM_API_KEY`, `GITFERRET_GITHUB_TOKEN`). Don’t commit them to git.

## Development (this repo)

```bash
npm install
npm run build
node dist/index.js --help
```

Optional (for a `gitferret` command in your shell while developing):

```bash
npm link
gitferret --help
```

## Requirements

- Node.js `>= 20`
- Git (for `gitferret changes` and `gitferret install`)
