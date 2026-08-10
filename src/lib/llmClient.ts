/**
 * Unified LLM client (Plan01 / Plan3 MVP).
 * OpenAI-compatible chat/completions against baseUrl + apiKey.
 */

export type LlmConfig =
  | { mode: "hosted"; baseUrl: string; apiKey: string; model: string }
  | {
      mode: "custom";
      providerName: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      api: "openai-completions";
    }
  | { mode: "mock" };

export type ChatRequestMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionsErrorCode =
  | "not_configured"
  | "unauthorized"
  | "network"
  | "cors_or_network"
  | "timeout"
  | "bad_response"
  | "http";

export class LlmClientError extends Error {
  code: ChatCompletionsErrorCode;
  status?: number;

  constructor(code: ChatCompletionsErrorCode, message: string, status?: number) {
    super(message);
    this.name = "LlmClientError";
    this.code = code;
    this.status = status;
  }
}

export function isUsableLlmConfig(
  config: LlmConfig | null | undefined,
): config is Exclude<LlmConfig, { mode: "mock" }> {
  if (!config || config.mode === "mock") return false;
  return Boolean(config.baseUrl?.trim() && config.apiKey?.trim() && config.model?.trim());
}

function joinChatUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return `${base}/chat/completions`;
}

/** Extract incremental text from one OpenAI-compatible SSE JSON payload. */
export function extractStreamDelta(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    return "";
  }
  const choice = choices[0] as {
    delta?: { content?: unknown };
    message?: { content?: unknown };
  };
  const fromDelta = choice.delta?.content;
  if (typeof fromDelta === "string") return fromDelta;
  const fromMessage = choice.message?.content;
  if (typeof fromMessage === "string") return fromMessage;
  return "";
}

/** Parse an SSE chunk buffer; returns emitted text deltas and leftover bytes. */
export function consumeSseBuffer(buffer: string): { deltas: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  const deltas: string[] = [];
  for (const part of parts) {
    const lines = part.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const delta = extractStreamDelta(JSON.parse(payload));
        if (delta) deltas.push(delta);
      } catch {
        // Ignore malformed SSE frames; upstream occasionally sends keep-alives.
      }
    }
  }
  return { deltas, rest };
}

export async function chatCompletions(args: {
  config: LlmConfig;
  messages: ChatRequestMessage[];
  signal?: AbortSignal;
  /** Defaults to true so the UI can render tokens as they arrive. */
  stream?: boolean;
  onDelta?: (delta: string) => void;
}): Promise<string> {
  const { config, messages, signal, onDelta } = args;
  const stream = args.stream !== false;
  if (!isUsableLlmConfig(config)) {
    throw new LlmClientError("not_configured", "LLM is not configured");
  }

  const url = joinChatUrl(config.baseUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream,
      }),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new LlmClientError("timeout", "Request aborted");
    }
    throw new LlmClientError(
      "cors_or_network",
      e instanceof Error ? e.message : "Network error",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new LlmClientError("unauthorized", "Unauthorized", response.status);
  }
  if (!response.ok) {
    const detail = await safeText(response);
    throw new LlmClientError(
      "http",
      detail || `HTTP ${response.status}`,
      response.status,
    );
  }

  if (!stream) {
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new LlmClientError("bad_response", "Invalid JSON response");
    }
    const content = extractContent(data);
    if (content == null || content === "") {
      throw new LlmClientError("bad_response", "Empty model response");
    }
    onDelta?.(content);
    return content;
  }

  if (!response.body) {
    throw new LlmClientError("bad_response", "Streaming response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const consumed = consumeSseBuffer(buffer);
    buffer = consumed.rest;
    for (const delta of consumed.deltas) {
      full += delta;
      onDelta?.(delta);
    }
  }
  buffer += decoder.decode();
  const trailing = consumeSseBuffer(buffer.endsWith("\n\n") ? buffer : `${buffer}\n\n`);
  for (const delta of trailing.deltas) {
    full += delta;
    onDelta?.(delta);
  }

  if (!full.trim()) {
    throw new LlmClientError("bad_response", "Empty model response");
  }
  return full;
}

function extractContent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    return null;
  }
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === "string") return content;
  return null;
}

async function safeText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 280);
  } catch {
    return "";
  }
}
