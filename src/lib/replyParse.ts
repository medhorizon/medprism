import type { ChatSuggestion } from "../types/chat";

export type ParsedAssistantReply = {
  content: string;
  suggestions: ChatSuggestion[];
};

/**
 * Parse assistant output for structured suggestions.
 * Supported forms:
 * 1) ```suggestion ... ``` fence with path/title header
 * 2) ```json ... {"content","suggestions":[{path,title,body}]} ```
 */
export function parseAssistantReply(raw: string): ParsedAssistantReply {
  const suggestions: ChatSuggestion[] = [];
  let content = raw.trim();

  const jsonFence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFence) {
    try {
      const parsed = JSON.parse(jsonFence[1]!) as {
        content?: string;
        suggestions?: Array<{ path?: string; title?: string; body?: string }>;
      };
      if (typeof parsed.content === "string") content = parsed.content;
      for (const s of parsed.suggestions ?? []) {
        if (s.body) {
          suggestions.push({
            path: s.path,
            title: s.title || s.path || "suggestion",
            body: s.body,
            status: "pending",
          });
        }
      }
      if (suggestions.length) {
        content = raw.replace(jsonFence[0], "").replace(/\n{3,}/g, "\n\n").trim() || content;
        return { content, suggestions };
      }
    } catch {
      /* fall through */
    }
  }

  const fenceRe = /```suggestion\s*([\s\S]*?)```/gi;
  let stripped = raw;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    const parsed = parseSuggestionFence(m[1] ?? "");
    if (parsed) suggestions.push(parsed);
    stripped = stripped.replace(m[0], "");
  }

  if (suggestions.length) {
    content = stripped.replace(/\n{3,}/g, "\n\n").trim() || content;
  }

  return { content, suggestions };
}

function parseSuggestionFence(inner: string): ChatSuggestion | null {
  const parts = inner.split(/\n---\n/);
  if (parts.length >= 2) {
    const header = parts[0]!;
    const body = parts.slice(1).join("\n---\n").trim();
    const path = header.match(/^path:\s*(.+)$/im)?.[1]?.trim();
    const title = header.match(/^title:\s*(.+)$/im)?.[1]?.trim();
    if (!body) return null;
    return {
      path,
      title: title || path || "suggestion",
      body,
      status: "pending",
    };
  }

  const lines = inner.trim().split("\n");
  const pathLine = lines[0]?.match(/^path:\s*(.+)$/i);
  if (pathLine && lines.length > 1) {
    return {
      path: pathLine[1]!.trim(),
      title: pathLine[1]!.trim(),
      body: lines.slice(1).join("\n").replace(/^---\s*\n/, "").trim(),
      status: "pending",
    };
  }

  return null;
}
