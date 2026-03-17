import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export type RepoContextOptions = {
  /**
   * Maximum number of files to include in the context.
   */
  maxFiles?: number;
  /**
   * Maximum characters per file (UTF-8 decoded). Files are truncated.
   */
  maxCharsPerFile?: number;
  /**
   * Maximum total characters across all included files.
   */
  maxTotalChars?: number;
  /**
   * Skip individual files larger than this many bytes.
   */
  maxFileBytes?: number;
};

export type RepoContextResult = {
  context: string;
  includedFiles: string[];
  scannedFiles: number;
  truncatedFiles: string[];
};

const INCLUDED_EXTS = new Set([".js", ".ts", ".jsx", ".tsx"]);
const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".git"]);

function toRepoRelative(p: string): string {
  const rel = path.relative(process.cwd(), p);
  return rel.split(path.sep).join("/");
}

function tokenizeQuestion(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && t.length <= 40)
    .slice(0, 20);
}

function scorePath(fileRel: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const s = fileRel.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (s.includes(t)) score += 2;
  }
  // Prefer "src" and shorter paths slightly.
  if (s.includes("/src/")) score += 1;
  score += Math.max(0, 4 - Math.floor(s.length / 40));
  return score;
}

async function readUtf8UpToChars(
  filePath: string,
  maxChars: number
): Promise<{ text: string; truncated: boolean }> {
  // Avoid loading huge files fully into memory: read as buffer up to an upper bound,
  // then decode and truncate. Since we cap bytes separately, this stays cheap.
  const buf = await (await import("node:fs/promises")).readFile(filePath);
  const text = buf.toString("utf8");
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

async function walkFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length) {
    const dir = stack.pop() as string;
    let entries;
    try {
      // Keep this un-annotated so TS picks the string-encoding overload.
      entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" } as const);
    } catch {
      continue;
    }

    for (const ent of entries) {
      const name = ent.name as string;
      const full = path.join(dir, name);
      if (ent.isDirectory()) {
        if (EXCLUDED_DIRS.has(name)) continue;
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = path.extname(name).toLowerCase();
      if (!INCLUDED_EXTS.has(ext)) continue;
      out.push(full);
    }
  }

  return out;
}

export async function buildRepoContext(
  question: string,
  options: RepoContextOptions = {}
): Promise<RepoContextResult> {
  const maxFiles = Number.isFinite(options.maxFiles) && (options.maxFiles as number) > 0 ? Math.floor(options.maxFiles as number) : 20;
  const maxCharsPerFile =
    Number.isFinite(options.maxCharsPerFile) && (options.maxCharsPerFile as number) > 0
      ? Math.floor(options.maxCharsPerFile as number)
      : 4_000;
  const maxTotalChars =
    Number.isFinite(options.maxTotalChars) && (options.maxTotalChars as number) > 0
      ? Math.floor(options.maxTotalChars as number)
      : 24_000;
  const maxFileBytes =
    Number.isFinite(options.maxFileBytes) && (options.maxFileBytes as number) > 0
      ? Math.floor(options.maxFileBytes as number)
      : 200_000;

  const tokens = tokenizeQuestion(question);
  const all = await walkFiles(process.cwd());
  const scored = all
    .map((abs) => {
      const rel = toRepoRelative(abs);
      return { abs, rel, score: scorePath(rel, tokens) };
    })
    .sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));

  let totalChars = 0;
  let scannedFiles = 0;
  const includedFiles: string[] = [];
  const truncatedFiles: string[] = [];
  const parts: string[] = [];

  for (const f of scored) {
    if (includedFiles.length >= maxFiles) break;
    if (totalChars >= maxTotalChars) break;

    scannedFiles++;
    let st;
    try {
      st = await stat(f.abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > maxFileBytes) continue;

    const remaining = maxTotalChars - totalChars;
    const perFileBudget = Math.max(200, Math.min(maxCharsPerFile, remaining));

    try {
      const r = await readUtf8UpToChars(f.abs, perFileBudget);
      const header = `--- file: ${f.rel} ---\n`;
      parts.push(header + r.text.trimEnd() + "\n");
      includedFiles.push(f.rel);
      totalChars += header.length + r.text.length + 1;
      if (r.truncated) truncatedFiles.push(f.rel);
    } catch {
      continue;
    }
  }

  return {
    context: parts.join("\n").trim(),
    includedFiles,
    scannedFiles,
    truncatedFiles
  };
}

