export type DiffHunk = {
  header: string; // @@ -a,b +c,d @@ ...
  lines: string[]; // includes only + / - lines (no context), excluding file markers
};

export type DiffFile = {
  oldPath: string | null;
  newPath: string | null;
  hunks: DiffHunk[];
  isBinary: boolean;
};

function stripPrefix(path: string): string {
  // paths in unified diff are often "a/foo" and "b/foo"
  return path.replace(/^(a|b)\//, "");
}

function parseFileMarker(line: string): string | null {
  // --- a/file or +++ b/file
  const m = line.match(/^(---|\+\+\+)\s+(\S+)\s*$/);
  if (!m) return null;
  const p = m[2]!;
  if (p === "/dev/null") return null;
  return stripPrefix(p);
}

/**
 * Parses a GitHub "application/vnd.github.v3.diff" unified diff.
 * Keeps only per-file hunks and their changed lines (+/-), dropping context to optimize tokens.
 */
export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const lines = (diffText ?? "").split(/\r?\n/);
  const files: DiffFile[] = [];

  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

  const flushHunk = () => {
    if (!current || !currentHunk) return;
    if (currentHunk.lines.length > 0) current.hunks.push(currentHunk);
    currentHunk = null;
  };

  const flushFile = () => {
    if (!current) return;
    flushHunk();
    // Keep file entries that have changes or are binary markers.
    if (current.isBinary || current.hunks.length > 0) files.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw ?? "";

    if (line.startsWith("diff --git ")) {
      flushFile();
      current = { oldPath: null, newPath: null, hunks: [], isBinary: false };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("Binary files ")) {
      current.isBinary = true;
      continue;
    }

    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const p = parseFileMarker(line);
      if (line.startsWith("--- ")) current.oldPath = p;
      else current.newPath = p;
      continue;
    }

    if (line.startsWith("@@")) {
      flushHunk();
      currentHunk = { header: line.trimEnd(), lines: [] };
      continue;
    }

    // Inside hunks: keep only changed lines, and skip file markers which also begin with +/-.
    if (currentHunk) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.lines.push(line);
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk.lines.push(line);
      }
    }
  }

  flushFile();
  return files;
}

export function toMinimizedDiff(files: DiffFile[]): string {
  const out: string[] = [];
  for (const f of files) {
    const display = f.newPath ?? f.oldPath ?? "(unknown file)";
    out.push(`File: ${display}`);
    if (f.isBinary) {
      out.push("(binary change)");
      out.push("");
      continue;
    }
    for (const h of f.hunks) {
      out.push(h.header);
      out.push(...h.lines);
      out.push("");
    }
    if (f.hunks.length === 0) out.push("(no textual hunks)");
    out.push("");
  }
  return out.join("\n").trimEnd();
}

export function truncateToChars(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

