# PRLens 🔍

AI-powered CLI tool for reviewing pull requests and understanding codebases using diff-based analysis.

## Usage

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

### Run

```bash
node dist/index.js --help
node dist/index.js review README.md
node dist/index.js pr 123 --repo owner/repo
node dist/index.js ask "What does this repo do?"
```

### Environment

- `PRLENS_LOG_LEVEL`: `debug` | `info` | `warn` | `error` (default: `info`)
- `PRLENS_GITHUB_TOKEN` (or `GITHUB_TOKEN`): GitHub token for fetching PRs/diffs