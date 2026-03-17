type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string | null;
  };
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
    status?: string;
    code?: number;
  };
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
  provider?: "openai-compatible" | "gemini" | "anthropic";
};

export type LlmProvider = "openai-compatible" | "gemini" | "anthropic";

type LlmClient = {
  analyze(prompt: string, options?: AnalyzeOptions): Promise<string>;
};

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
  return withFormatRules([
    "Review the following pull request diff.",
    "Focus on correctness, security, performance, and maintainability.",
    "If something is unknown from the diff, state assumptions briefly.",
    "",
    "Diff:",
    "```diff",
    diff.trim(),
    "```"
  ].join("\n"));
}

export function buildFileReviewPrompt(code: string): string {
  return withFormatRules([
    "Review the following code file.",
    "Focus on correctness, security, readability, and edge cases.",
    "",
    "Code:",
    "```",
    code.trim(),
    "```"
  ].join("\n"));
}

export function buildRepoQueryPrompt(context: string, question: string): string {
  return withFormatRules([
    "Answer the question using only the provided repository context.",
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
 * - PRLENS_LLM_PROVIDER=openai-compatible
 * - PRLENS_LLM_BASE_URL=https://api.openai.com
 * - PRLENS_LLM_API_KEY=...
 * - PRLENS_LLM_MODEL=...
 * - PRLENS_LLM_TIMEOUT_MS=30000
 *
 * Back-compat (also supported):
 * - OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL / OPENAI_TIMEOUT_MS
 */
export async function analyze(prompt: string, options: AnalyzeOptions = {}): Promise<string> {
  const provider: LlmProvider =
    options.provider ??
    (getEnvFirst("PRLENS_LLM_PROVIDER") as LlmProvider | undefined) ??
    "openai-compatible";

  const client: LlmClient =
    provider === "openai-compatible"
      ? new OpenAICompatibleClient()
      : provider === "gemini"
        ? new GeminiClient()
        : provider === "anthropic"
          ? new AnthropicClient()
        : (() => {
            throw new Error(`Unsupported LLM provider: ${provider}`);
          })();
  return client.analyze(prompt, options);
}

class OpenAICompatibleClient implements LlmClient {
  private defaultBaseUrl(): string {
    return normalizeBaseUrl(
      getEnvFirst("PRLENS_LLM_BASE_URL", "OPENAI_BASE_URL") ?? "https://api.openai.com"
    );
  }

  private defaultModel(): string {
    return getEnvFirst("PRLENS_LLM_MODEL", "OPENAI_MODEL") ?? "gpt-4o-mini";
  }

  private defaultTimeoutMs(): number {
    return parsePositiveInt(getEnvFirst("PRLENS_LLM_TIMEOUT_MS", "OPENAI_TIMEOUT_MS"), 30_000);
  }

  private resolveApiKey(baseUrl: string, override?: string): string | undefined {
    if (override && override.trim()) return override.trim();
    const key = getEnvFirst("PRLENS_LLM_API_KEY", "OPENAI_API_KEY");
    if (key) return key;
    // Allow local OpenAI-compatible servers that don't require a key.
    if (isLocalhostBaseUrl(baseUrl)) return "ollama";
    return undefined;
  }

  async analyze(prompt: string, options: AnalyzeOptions = {}): Promise<string> {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? this.defaultBaseUrl());
    const model = options.model ?? this.defaultModel();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs();
    const apiKey = this.resolveApiKey(baseUrl, options.apiKey);
    if (!apiKey) {
      throw new Error(
        "Missing API key. Set PRLENS_LLM_API_KEY (preferred) or OPENAI_API_KEY, or use a localhost base URL."
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [{ role: "user", content: prompt }]
        }),
        signal: controller.signal
      });

      const text = await res.text();
      let data: OpenAIChatCompletionResponse | undefined;
      try {
        data = text ? (JSON.parse(text) as OpenAIChatCompletionResponse) : undefined;
      } catch {
        // ignore JSON parse failures; handle below
      }

      if (!res.ok) {
        const msg =
          data?.error?.message ??
          (text ? text.slice(0, 500) : undefined) ??
          `Request failed with status ${res.status}`;
        throw new Error(`LLM API error (${res.status}): ${msg}`);
      }

      const content = data?.choices?.[0]?.message?.content ?? "";
      const trimmed = content.trim();
      if (!trimmed) throw new Error("LLM returned an empty response.");
      return trimmed;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`LLM request timed out after ${timeoutMs}ms.`);
      }
      if (err instanceof Error) throw err;
      throw new Error(String(err));
    } finally {
      clearTimeout(timeout);
    }
  }
}

class GeminiClient implements LlmClient {
  private defaultBaseUrl(): string {
    return normalizeBaseUrl(
      getEnvFirst("PRLENS_LLM_BASE_URL", "GEMINI_BASE_URL") ??
        "https://generativelanguage.googleapis.com"
    );
  }

  private defaultApiVersion(): string {
    return getEnvFirst("PRLENS_GEMINI_API_VERSION") ?? "v1";
  }

  private defaultModel(): string {
    // Gemini REST expects "models/<modelName>"
    const raw = getEnvFirst("PRLENS_LLM_MODEL", "GEMINI_MODEL") ?? "gemini-2.0-flash";
    return raw.startsWith("models/") ? raw : `models/${raw}`;
  }

  private defaultTimeoutMs(): number {
    return parsePositiveInt(getEnvFirst("PRLENS_LLM_TIMEOUT_MS", "GEMINI_TIMEOUT_MS"), 30_000);
  }

  private resolveApiKey(override?: string): string | undefined {
    if (override && override.trim()) return override.trim();
    return getEnvFirst("PRLENS_LLM_API_KEY", "GEMINI_API_KEY");
  }

  async analyze(prompt: string, options: AnalyzeOptions = {}): Promise<string> {
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
      throw new Error("Missing API key. Set PRLENS_LLM_API_KEY (preferred) or GEMINI_API_KEY.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = new URL(`${baseUrl}/${apiVersion}/${model}:generateContent`);
      url.searchParams.set("key", apiKey);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.2
          }
        }),
        signal: controller.signal
      });

      const text = await res.text();
      let data: GeminiGenerateContentResponse | undefined;
      try {
        data = text ? (JSON.parse(text) as GeminiGenerateContentResponse) : undefined;
      } catch {
        // ignore JSON parse failures; handle below
      }

      if (!res.ok) {
        const msg =
          data?.error?.message ??
          (text ? text.slice(0, 500) : undefined) ??
          `Request failed with status ${res.status}`;
        throw new Error(`LLM API error (${res.status}): ${msg}`);
      }

      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const content = parts.map((p) => p.text ?? "").join("").trim();
      if (!content) throw new Error("LLM returned an empty response.");
      return content;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`LLM request timed out after ${timeoutMs}ms.`);
      }
      if (err instanceof Error) throw err;
      throw new Error(String(err));
    } finally {
      clearTimeout(timeout);
    }
  }
}

class AnthropicClient implements LlmClient {
  private defaultBaseUrl(): string {
    return normalizeBaseUrl(
      getEnvFirst("PRLENS_LLM_BASE_URL", "ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com"
    );
  }

  private defaultModel(): string {
    return getEnvFirst("PRLENS_LLM_MODEL", "ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest";
  }

  private defaultTimeoutMs(): number {
    return parsePositiveInt(getEnvFirst("PRLENS_LLM_TIMEOUT_MS", "ANTHROPIC_TIMEOUT_MS"), 30_000);
  }

  private resolveApiKey(override?: string): string | undefined {
    if (override && override.trim()) return override.trim();
    return getEnvFirst("PRLENS_LLM_API_KEY", "ANTHROPIC_API_KEY");
  }

  async analyze(prompt: string, options: AnalyzeOptions = {}): Promise<string> {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? this.defaultBaseUrl());
    const model = options.model ?? this.defaultModel();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs();
    const apiKey = this.resolveApiKey(options.apiKey);
    if (!apiKey) {
      throw new Error("Missing API key. Set PRLENS_LLM_API_KEY (preferred) or ANTHROPIC_API_KEY.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/v1/messages`, {
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
        }),
        signal: controller.signal
      });

      const text = await res.text();
      let data: AnthropicMessagesResponse | undefined;
      try {
        data = text ? (JSON.parse(text) as AnthropicMessagesResponse) : undefined;
      } catch {
        // ignore JSON parse failures; handle below
      }

      if (!res.ok) {
        const msg =
          data?.error?.message ??
          (text ? text.slice(0, 500) : undefined) ??
          `Request failed with status ${res.status}`;
        throw new Error(`LLM API error (${res.status}): ${msg}`);
      }

      const content = (data?.content ?? [])
        .filter((p) => (p.type ?? "text") === "text")
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!content) throw new Error("LLM returned an empty response.");
      return content;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`LLM request timed out after ${timeoutMs}ms.`);
      }
      if (err instanceof Error) throw err;
      throw new Error(String(err));
    } finally {
      clearTimeout(timeout);
    }
  }
}

