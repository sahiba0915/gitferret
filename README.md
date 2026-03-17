# PRLens

PRLens is a developer-friendly CLI for getting **fast, structured AI reviews** of:

- Local files (`prlens review`)
- GitHub PR diffs (`prlens pr`)
- Your local branch changes vs upstream (`prlens changes`)
- Questions about your codebase (`prlens ask`)

It minimizes diffs (keeps only changed lines) to reduce tokens and keep reviews focused.

## Install

PRLens is not published to npm yet in this repo. To use it, clone the repo and run it locally.

```bash
npm install
npm run build
node dist/index.js --help
```

Optional (for a `prlens` command in your shell while developing):

```bash
npm link
prlens --help
```

## Quick start

```bash
node dist/index.js review README.md
node dist/index.js pr 123 --repo vercel/next.js
node dist/index.js changes
node dist/index.js ask "Where is config loaded?"
node dist/index.js version
```

## How to use

### Install (dev / from this repo)

```bash
npm install
npm run build
node dist/index.js --help
```

### Set env (required for AI)

Pick one LLM provider and set its key (details are in this README under **LLM Provider**). Example (OpenAI-compatible):

```bash
export PRLENS_LLM_PROVIDER=openai-compatible
export PRLENS_LLM_BASE_URL=https://api.openai.com
export PRLENS_LLM_API_KEY=...
export PRLENS_LLM_MODEL=gpt-4o-mini
```

If they want `prlens pr`, also set:

```bash
export PRLENS_GITHUB_TOKEN=...
```

### Run commands

#### Review a file

```bash
node dist/index.js review README.md
```

#### Review a GitHub PR

```bash
node dist/index.js pr 123 --repo vercel/next.js
```

#### Review local branch changes vs upstream

```bash
node dist/index.js changes
```

#### Ask a question about the repo

```bash
node dist/index.js ask "Where is config loaded?"
```

#### Print version

```bash
node dist/index.js version
```

### Optional: run before every push

Inside a git repo:

```bash
node dist/index.js install
```

That installs a `pre-push` hook that runs `prlens changes` before pushing.

## Commands

### `review <file>`

Review a local file and print a structured report.

```bash
node dist/index.js review src/index.ts
node dist/index.js review src/index.ts --max-chars 8000
```

### `pr <number> --repo <owner/repo>`

Fetch the PR diff from GitHub, minimize it, then generate a structured AI review.

```bash
node dist/index.js pr 123 --repo vercel/next.js
node dist/index.js pr 123 --repo owner/repo --max-chars 8000
```

### `changes`

Review your local changes vs the configured upstream branch.

Under the hood it runs:

```bash
git diff --unified=0 @{u}...HEAD
```

Examples:

```bash
node dist/index.js changes
node dist/index.js changes --max-chars 8000
```

If you don’t have an upstream branch set, configure one (example):

```bash
git branch --set-upstream-to origin/main
```

### `ask "<question>"`

Ask a question about your local codebase (PRLens scans a limited subset of files for context).

```bash
node dist/index.js ask "How does auth work?"
node dist/index.js ask "Where is the database client created?"
```

### `install` (optional)

Installs a git `pre-push` hook that runs `prlens changes` before pushing.

```bash
node dist/index.js install
node dist/index.js install --force
```

This writes `.git/hooks/pre-push` to run:

```bash
node ./dist/index.js changes
```

## Configuration

### Logging

- `PRLENS_LOG_LEVEL`: `debug` | `info` | `warn` | `error` (default: `info`)

### GitHub (for `prlens pr`)

- `PRLENS_GITHUB_TOKEN` (recommended) or `GITHUB_TOKEN`

### LLM Provider (required for AI)

PRLens supports multiple providers. Pick one.

#### OpenAI / OpenAI-compatible (default)

```bash
export PRLENS_LLM_PROVIDER=openai-compatible
export PRLENS_LLM_BASE_URL=https://api.openai.com
export PRLENS_LLM_API_KEY=...
export PRLENS_LLM_MODEL=gpt-4o-mini
```

Back-compat env vars also work: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`.

#### Gemini

```bash
export PRLENS_LLM_PROVIDER=gemini
export PRLENS_LLM_API_KEY=...
export PRLENS_LLM_MODEL=gemini-2.0-flash
```

#### Anthropic

```bash
export PRLENS_LLM_PROVIDER=anthropic
export PRLENS_LLM_API_KEY=...
export PRLENS_LLM_MODEL=claude-3-5-sonnet-latest
```

## Development (this repo)

```bash
npm install
npm run build
node dist/index.js --help
```

## Requirements

- Node.js `>= 20`
- Git (for `prlens changes` and `prlens install`)