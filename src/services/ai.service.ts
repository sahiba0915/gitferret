import { focusDirectiveForPrompt } from "../config/gitferretConfig.js";

type OpenAIChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string; type?: string; code?: string | null };
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string; status?: string; code?: number };
};

type AnthropicMessagesResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string; type?: string };
};

export type AnalyzeOptions = {
  /**
   * Override the default model via code (env still applies).
   * If omitted, uses provider defaults / env.
   */
  model?: string;
  /**
   * Timeout in milliseconds for the HTTP request.
   * If omitted, uses provider defaults / env.
   */
  timeoutMs?: number;
  /**
   * Override API base URL (useful for proxies / local servers).
   */
  baseUrl?: string;
  /**
   * Override API key.
   */
  apiKey?: string;
  /**
   * Override provider selection.
   */
  provider?: LlmProvider;
};

export type LlmProvider = "openai-compatible" | "gemini" | "anthropic";

type LlmClient = {
  analyze(prompt: string, options?: AnalyzeOptions): Promise<string>;
};

type HttpResult = { res: Response; text: string };

export class LlmApiError extends Error {
  readonly provider: LlmProvider;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly details: string | undefined;

  constructor(args: {
    provider: LlmProvider;
    message: string;
    status?: number;
    retryAfterMs?: number;
    details?: string;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "LlmApiError";
    this.provider = args.provider;
    this.status = args.status;
    this.retryAfterMs = args.retryAfterMs;
    this.details = args.details;
    if (args.cause !== undefined) (this as { cause?: unknown }).cause = args.cause;
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getEnvFirst(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/g, "");
}

function isLocalhostBaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
  } catch {
    return false;
  }
}

function safeJsonParse<T>(text: string): T | undefined {
  try {
    return text ? (JSON.parse(text) as T) : undefined;
  } catch {
    return undefined;
  }
}

function parseRetryAfterMs(res: Response): number | undefined {
  const ra = res.headers.get("retry-after");
  if (!ra) return undefined;
  const seconds = Number(ra);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
  const dateMs = Date.parse(ra);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
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

function toTimeoutError(provider: LlmProvider, timeoutMs: number, cause: unknown): LlmApiError {
  return new LlmApiError({
    provider,
    message: `LLM request timed out after ${timeoutMs}ms.`,
    cause
  });
}

function missingKeyError(provider: LlmProvider, hint: string): LlmApiError {
  return new LlmApiError({
    provider,
    message: `Missing API key. ${hint}`
  });
}

function withFormatRules(task: string): string {
  return [
    "You are a senior software engineer.",
    "Keep the response concise and actionable.",
    "Follow the exact output format below (use numbered headings):",
    "",
    "1. Critical Issues",
    "2. Improvements",
    "3. Suggestions",
    "4. Summary",
    "",
    task.trim()
  ].join("\n");
}

export function buildPRReviewPrompt(diff: string): string {
  const focusLine = focusDirectiveForPrompt(
    "Focus on correctness, security, performance, and maintainability."
  );
  return withFormatRules([
    "Review the following pull request diff.",
    focusLine,
    "If something is unknown from the diff, state assumptions briefly.",
    "",
    "Diff:",
    "```diff",
    diff.trim(),
    "```"
  ].join("\n"));
}

export function buildFileReviewPrompt(code: string): string {
  const focusLine = focusDirectiveForPrompt(
    "Focus on correctness, security, readability, and edge cases."
  );
  return withFormatRules([
    "Review the following code file.",
    focusLine,
    "",
    "Code:",
    "```",
    code.trim(),
    "```"
  ].join("\n"));
}

export function buildRepoQueryPrompt(context: string, question: string): string {
  const focusLine = focusDirectiveForPrompt(
    "Prioritize correctness and clarity, and keep the answer focused on what the context supports."
  );
  return withFormatRules([
    "Answer the question using only the provided repository context.",
    focusLine,
    "If context is insufficient, say what's missing and propose next steps.",
    "",
    "Context:",
    "```",
    context.trim(),
    "```",
    "",
    "Question:",
    question.trim()
  ].join("\n"));
}

/**
 * LLM-agnostic analysis entrypoint.
 *
 * Default provider is "openai-compatible", which works with OpenAI and many
 * OpenAI-compatible servers (e.g. local Ollama / proxies), using env vars:
 *
 * Preferred:
 * - GITFERRET_LLM_PROVIDER=openai-compatible
 * - GITFERRET_LLM_BASE_URL=https://api.openai.com
 * - GITFERRET_LLM_API_KEY=...
 * - GITFERRET_LLM_MODEL=...
 * - GITFERRET_LLM_TIMEOUT_MS=30000
 *
 * Back-compat (also supported):
 * - OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL / OPENAI_TIMEOUT_MS
 */
export async function analyze(prompt: string, options: AnalyzeOptions = {}): Promise<string> {
  const provider: LlmProvider =
    options.provider ??
    (getEnvFirst("GITFERRET_LLM_PROVIDER") as LlmProvider | undefined) ??
    "openai-compatible";

  const client = PROVIDERS[provider];
  if (!client) {
    throw new LlmApiError({ provider, message: `Unsupported LLM provider: ${provider}` });
  }
  return client.analyze(prompt, options);
}

class OpenAICompatibleClient implements LlmClient {
  private defaultBaseUrl(): string {
    return normalizeBaseUrl(
      getEnvFirst("GITFERRET_LLM_BASE_URL", "OPENAI_BASE_URL") ?? "https://api.openai.com"
    );
  }

  private defaultModel(): string {
    return getEnvFirst("GITFERRET_LLM_MODEL", "OPENAI_MODEL") ?? "gpt-4o-mini";
  }

  private defaultTimeoutMs(): number {
    return parsePositiveInt(getEnvFirst("GITFERRET_LLM_TIMEOUT_MS", "OPENAI_TIMEOUT_MS"), 30_000);
  }

  private resolveApiKey(baseUrl: string, override?: string): string | undefined {
    if (override && override.trim()) return override.trim();
    const key = getEnvFirst("GITFERRET_LLM_API_KEY", "OPENAI_API_KEY");
    if (key) return key;
    // Allow local OpenAI-compatible servers that don't require a key.
    if (isLocalhostBaseUrl(baseUrl)) return "ollama";
    return undefined;
  }

  async analyze(prompt: string, options: AnalyzeOptions = {}): Promise<string> {
    const provider: LlmProvider = "openai-compatible";
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? this.defaultBaseUrl());
    const model = options.model ?? this.defaultModel();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs();
    const apiKey = this.resolveApiKey(baseUrl, options.apiKey);
    if (!apiKey) {
      throw missingKeyError(
        provider,
        "Set GITFERRET_LLM_API_KEY (preferred) or OPENAI_API_KEY, or use a localhost base URL."
      );
    }

    try {
      const { res, text } = await fetchTextWithTimeout(
        `${baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [{ role: "user", content: prompt }]
          })
        },
        timeoutMs
      );

      const data = safeJsonParse<OpenAIChatCompletionResponse>(text);
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res);
        throw new LlmApiError({
          provider,
          status: res.status,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          message: `LLM API error (${res.status}): ${data?.error?.message ?? (text ? text.slice(0, 500) : "Request failed")}`,
          ...(text ? { details: text } : {})
        });
      }

      const content = data?.choices?.[0]?.message?.content ?? "";
      const trimmed = content.trim();
      if (!trimmed) {
        throw new LlmApiError({ provider, status: res.status, message: "LLM returned an empty response." });
      }
      return trimmed;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") throw toTimeoutError(provider, timeoutMs, err);
      if (err instanceof LlmApiError) throw err;
      if (err instanceof Error) {
        throw new LlmApiError({ provider, message: err.message, cause: err });
      }
      throw new LlmApiError({ provider, message: String(err) });
    }
  }
}

class GeminiClient implements LlmClient {
  private defaultBaseUrl(): string {
    return normalizeBaseUrl(
      getEnvFirst("GITFERRET_LLM_BASE_URL", "GEMINI_BASE_URL") ??
        "https://generativelanguage.googleapis.com"
    );
  }

  private defaultApiVersion(): string {
    return getEnvFirst("GITFERRET_GEMINI_API_VERSION") ?? "v1";
  }

  private defaultModel(): string {
    // Gemini REST expects "models/<modelName>"
    const raw = getEnvFirst("GITFERRET_LLM_MODEL", "GEMINI_MODEL") ?? "gemini-2.0-flash";
    return raw.startsWith("models/") ? raw : `models/${raw}`;
  }

  private defaultTimeoutMs(): number {
    return parsePositiveInt(getEnvFirst("GITFERRET_LLM_TIMEOUT_MS", "GEMINI_TIMEOUT_MS"), 30_000);
  }

  private resolveApiKey(override?: string): string | undefined {
    if (override && override.trim()) return override.trim();
    return getEnvFirst("GITFERRET_LLM_API_KEY", "GEMINI_API_KEY");
  }

  async analyze(prompt: string, options: AnalyzeOptions = {}): Promise<string> {
    const provider: LlmProvider = "gemini";
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? this.defaultBaseUrl());
    const apiVersion = this.defaultApiVersion();
    const model = options.model
      ? options.model.startsWith("models/")
        ? options.model
        : `models/${options.model}`
      : this.defaultModel();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs();
    const apiKey = this.resolveApiKey(options.apiKey);
    if (!apiKey) {
      throw missingKeyError(provider, "Set GITFERRET_LLM_API_KEY (preferred) or GEMINI_API_KEY.");
    }

    try {
      const url = new URL(`${baseUrl}/${apiVersion}/${model}:generateContent`);
      url.searchParams.set("key", apiKey);

      const { res, text } = await fetchTextWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 }
          })
        },
        timeoutMs
      );

      const data = safeJsonParse<GeminiGenerateContentResponse>(text);
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res);
        throw new LlmApiError({
          provider,
          status: res.status,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          message: `LLM API error (${res.status}): ${data?.error?.message ?? (text ? text.slice(0, 500) : "Request failed")}`,
          ...(text ? { details: text } : {})
        });
      }

      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const content = parts.map((p) => p.text ?? "").join("").trim();
      if (!content) {
        throw new LlmApiError({ provider, status: res.status, message: "LLM returned an empty response." });
      }
      return content;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") throw toTimeoutError(provider, timeoutMs, err);
      if (err instanceof LlmApiError) throw err;
      if (err instanceof Error) {
        throw new LlmApiError({ provider, message: err.message, cause: err });
      }
      throw new LlmApiError({ provider, message: String(err) });
    }
  }
}

class AnthropicClient implements LlmClient {
  private defaultBaseUrl(): string {
    return normalizeBaseUrl(
      getEnvFirst("GITFERRET_LLM_BASE_URL", "ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com"
    );
  }

  private defaultModel(): string {
    return getEnvFirst("GITFERRET_LLM_MODEL", "ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest";
  }

  private defaultTimeoutMs(): number {
    return parsePositiveInt(getEnvFirst("GITFERRET_LLM_TIMEOUT_MS", "ANTHROPIC_TIMEOUT_MS"), 30_000);
  }

  private resolveApiKey(override?: string): string | undefined {
    if (override && override.trim()) return override.trim();
    return getEnvFirst("GITFERRET_LLM_API_KEY", "ANTHROPIC_API_KEY");
  }

  async analyze(prompt: string, options: AnalyzeOptions = {}): Promise<string> {
    const provider: LlmProvider = "anthropic";
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? this.defaultBaseUrl());
    const model = options.model ?? this.defaultModel();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs();
    const apiKey = this.resolveApiKey(options.apiKey);
    if (!apiKey) {
      throw missingKeyError(provider, "Set GITFERRET_LLM_API_KEY (preferred) or ANTHROPIC_API_KEY.");
    }

    try {
      const { res, text } = await fetchTextWithTimeout(
        `${baseUrl}/v1/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": getEnvFirst("ANTHROPIC_VERSION") ?? "2023-06-01"
          },
          body: JSON.stringify({
            model,
            max_tokens: 800,
            temperature: 0.2,
            messages: [{ role: "user", content: prompt }]
          })
        },
        timeoutMs
      );

      const data = safeJsonParse<AnthropicMessagesResponse>(text);
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res);
        throw new LlmApiError({
          provider,
          status: res.status,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          message: `LLM API error (${res.status}): ${data?.error?.message ?? (text ? text.slice(0, 500) : "Request failed")}`,
          ...(text ? { details: text } : {})
        });
      }

      const content = (data?.content ?? [])
        .filter((p) => (p.type ?? "text") === "text")
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!content) {
        throw new LlmApiError({ provider, status: res.status, message: "LLM returned an empty response." });
      }
      return content;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") throw toTimeoutError(provider, timeoutMs, err);
      if (err instanceof LlmApiError) throw err;
      if (err instanceof Error) {
        throw new LlmApiError({ provider, message: err.message, cause: err });
      }
      throw new LlmApiError({ provider, message: String(err) });
    }
  }
}

const PROVIDERS: Record<LlmProvider, LlmClient> = {
  "openai-compatible": new OpenAICompatibleClient(),
  gemini: new GeminiClient(),
  anthropic: new AnthropicClient()
};

