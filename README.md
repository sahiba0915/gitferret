# PRLens

PRLens is a developer-friendly CLI for getting **fast, structured AI reviews** of:

- Local files (`prlens review`)
- GitHub PR diffs (`prlens pr`)
- Your local branch changes vs upstream (`prlens changes`)
- Questions about your codebase (`prlens ask`)

It minimizes diffs (keeps only changed lines) to reduce tokens and keep reviews focused.

## Install

### Use without installing

```bash
npx -y prlens --help
```

### Global install

```bash
npm i -g prlens
prlens --help
```

### Local (project) install

```bash
npm i -D prlens
npx prlens --help
```

## Quick start

```bash
prlens review README.md
prlens pr 123 --repo vercel/next.js
prlens changes
prlens ask "Where is config loaded?"
prlens version
```

## Commands

### `prlens review <file>`

Review a local file and print a structured report.

```bash
prlens review src/index.ts
prlens review src/index.ts --max-chars 8000
```

### `prlens pr <number> --repo <owner/repo>`

Fetch the PR diff from GitHub, minimize it, then generate a structured AI review.

```bash
prlens pr 123 --repo vercel/next.js
prlens pr 123 --repo owner/repo --max-chars 8000
```

### `prlens changes`

Review your local changes vs the configured upstream branch.

Under the hood it runs:

```bash
git diff --unified=0 @{u}...HEAD
```

Examples:

```bash
prlens changes
prlens changes --max-chars 8000
```

If you don’t have an upstream branch set, configure one (example):

```bash
git branch --set-upstream-to origin/main
```

### `prlens ask "<question>"`

Ask a question about your local codebase (PRLens scans a limited subset of files for context).

```bash
prlens ask "How does auth work?"
prlens ask "Where is the database client created?"
```

### `prlens install` (optional)

Installs a git `pre-push` hook that runs `prlens changes` before pushing.

```bash
prlens install
prlens install --force
```

This writes `.git/hooks/pre-push` to run:

```bash
npx -y prlens changes
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