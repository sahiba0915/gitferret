import chalk from "chalk";

export type ReviewSectionKey = "critical" | "improvements" | "suggestions" | "summary";

export type ParsedReviewSections = {
  critical: string;
  improvements: string;
  suggestions: string;
  summary: string;
  raw: string;
};

const SECTION_ORDER: ReviewSectionKey[] = ["critical", "improvements", "suggestions", "summary"];

const SECTION_META: Record<
  ReviewSectionKey,
  { title: "Critical Issues" | "Improvements" | "Suggestions" | "Summary"; label: string; color: (s: string) => string }
> = {
  critical: { title: "Critical Issues", label: "🔴 Critical Issues", color: (s) => chalk.red.bold(s) },
  improvements: { title: "Improvements", label: "🟡 Improvements", color: (s) => chalk.yellow.bold(s) },
  suggestions: { title: "Suggestions", label: "🟢 Suggestions", color: (s) => chalk.green.bold(s) },
  summary: { title: "Summary", label: "📌 Summary", color: (s) => chalk.cyan.bold(s) }
};

function normalizeTitleForMatch(title: string): string {
  return (title ?? "")
    .replace(/^\s*[\d\.\)\-–—]+/, "")
    .replace(/^[\p{Extended_Pictographic}\uFE0F]+\s*/gu, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .trim()
    .toLowerCase();
}

function keyFromTitle(title: string): ReviewSectionKey | undefined {
  const t = normalizeTitleForMatch(title);
  if (!t) return undefined;

  // Critical Issues
  if (
    t === "critical issues" ||
    t === "critical" ||
    t === "blockers" ||
    t === "blocking issues" ||
    t === "must fix" ||
    t === "must-fix" ||
    t === "bugs" ||
    t === "issues"
  ) {
    return "critical";
  }

  // Improvements
  if (
    t === "improvements" ||
    t === "improvement" ||
    t === "enhancements" ||
    t === "optimizations" ||
    t === "performance" ||
    t === "maintainability"
  ) {
    return "improvements";
  }

  // Suggestions
  if (
    t === "suggestions" ||
    t === "suggestion" ||
    t === "recommendations" ||
    t === "recommendation" ||
    t === "nits" ||
    t === "nitpicks" ||
    t === "nice to have" ||
    t === "nice-to-have"
  ) {
    return "suggestions";
  }

  // Summary
  if (t === "summary" || t === "overall" || t === "overall summary" || t === "tldr" || t === "tl dr") {
    return "summary";
  }

  // Soft matches for messy headings.
  if (/\bcritical\b/.test(t) || /\bblock(ing|er)s?\b/.test(t)) return "critical";
  if (/\bimprove(ment)?s?\b/.test(t) || /\benhance(ment)?s?\b/.test(t) || /\boptimi[sz]e/.test(t)) return "improvements";
  if (/\bsuggest(ion)?s?\b/.test(t) || /\brecommend(ation)?s?\b/.test(t) || /\bnit(s|pick)?\b/.test(t))
    return "suggestions";
  if (/\bsummary\b/.test(t) || /\boverall\b/.test(t) || /\btl\s*dr\b/.test(t)) return "summary";

  return undefined;
}

function normalizeBody(body: string): string {
  const lines = (body ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? "";
    line = line.replace(/\s+$/g, "");

    // Normalize common bullet variants to "- ".
    line = line.replace(/^\s*(?:•|·|●|▪|–|—|\*)\s+/, "- ");
    // Normalize numbered lists like "1)" or "1 -" to "1. "
    line = line.replace(/^\s*(\d+)\s*[\)\-:]\s+/, "$1. ");

    out.push(line);
  }

  // Trim leading/trailing blank lines and collapse excessive whitespace.
  while (out.length > 0 && !out[0]!.trim()) out.shift();
  while (out.length > 0 && !out[out.length - 1]!.trim()) out.pop();

  const collapsed: string[] = [];
  let blankRun = 0;
  for (const l of out) {
    if (!l.trim()) {
      blankRun++;
      if (blankRun <= 1) collapsed.push("");
      continue;
    }
    blankRun = 0;
    collapsed.push(l);
  }

  return collapsed.join("\n").trim();
}

type HeadingMatch = { index: number; titleLine: string; key: ReviewSectionKey };

function collectHeadings(text: string): HeadingMatch[] {
  const matches: HeadingMatch[] = [];

  const add = (m: RegExpMatchArray, titleLine: string) => {
    const key = keyFromTitle(titleLine);
    if (!key) return;
    matches.push({ index: m.index ?? 0, titleLine, key });
  };

  // Numbered headings: "1. Critical Issues"
  for (const m of text.matchAll(/^(\d+)\.\s+(.+?)\s*$/gm)) add(m, m[2] ?? "");
  // Markdown bold headings: "**Critical Issues**"
  for (const m of text.matchAll(/^\*\*(.+?)\*\*\s*$/gm)) add(m, m[1] ?? "");
  // Markdown hashes: "## Critical Issues"
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) add(m, m[1] ?? "");
  // Plain headings (best-effort): "Critical Issues:" / "Summary -"
  for (const m of text.matchAll(/^(Critical Issues|Improvements|Suggestions|Summary)\s*[:\-–—]\s*$/gim)) {
    add(m, m[1] ?? "");
  }

  // De-dup by position, keep earliest instance.
  matches.sort((a, b) => a.index - b.index);
  const deduped: HeadingMatch[] = [];
  for (const m of matches) {
    const last = deduped[deduped.length - 1];
    if (last && last.index === m.index) continue;
    deduped.push(m);
  }
  return deduped;
}

export function parseAiReview(raw: string): ParsedReviewSections {
  const text = (raw ?? "").trim();
  const empty: ParsedReviewSections = {
    critical: "",
    improvements: "",
    suggestions: "",
    summary: "",
    raw: text
  };
  if (!text) return empty;

  const headings = collectHeadings(text);
  if (headings.length === 0) {
    // No headings at all: keep the original as summary unless it's clearly long/sectioned.
    const body = normalizeBody(text);
    return { ...empty, summary: body || "" };
  }

  const buckets: Record<ReviewSectionKey, string[]> = {
    critical: [],
    improvements: [],
    suggestions: [],
    summary: []
  };

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i]!.index;
    const end = i + 1 < headings.length ? headings[i + 1]!.index : text.length;
    const chunk = text.slice(start, end).trimEnd();

    const firstNl = chunk.indexOf("\n");
    const body = firstNl === -1 ? "" : chunk.slice(firstNl + 1);
    const normalized = normalizeBody(body);
    if (normalized) buckets[headings[i]!.key].push(normalized);
  }

  return {
    critical: buckets.critical.join("\n\n").trim(),
    improvements: buckets.improvements.join("\n\n").trim(),
    suggestions: buckets.suggestions.join("\n\n").trim(),
    summary: buckets.summary.join("\n\n").trim(),
    raw: text
  };
}

export function formatAiReview(raw: string): string {
  const parsed = parseAiReview(raw);

  const out: string[] = [];
  for (const key of SECTION_ORDER) {
    const meta = SECTION_META[key];
    out.push(meta.color(meta.label));
    out.push(parsed[key] ? parsed[key] : chalk.gray("(none)"));
    out.push("");
  }

  return out.join("\n").trimEnd();
}

