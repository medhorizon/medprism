import { parsePatchSet, type PatchSet } from "./patch/schema";
import type { ChatSuggestion } from "../types/chat";

export type ParsedAssistantReply = {
  content: string;
  suggestions: ChatSuggestion[];
};

/**
 * Parse assistant output for PatchSet (preferred) or legacy suggestion fences.
 * Legacy `{path,title,body}` is kept as display-only (no Keep).
 */
export function parseAssistantReply(raw: string): ParsedAssistantReply {
  const suggestions: ChatSuggestion[] = [];
  let content = raw.trim();

  const jsonFence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFence) {
    try {
      const parsed = JSON.parse(jsonFence[1]!) as {
        content?: string;
        patchSet?: unknown;
        suggestions?: Array<{ path?: string; title?: string; body?: string }>;
      };
      if (typeof parsed.content === "string") content = parsed.content;

      if (parsed.patchSet !== undefined) {
        const ps = parsePatchSet(parsed.patchSet);
        if (ps.ok) {
          suggestions.push(suggestionFromPatchSet(ps.patchSet));
          content =
            raw.replace(jsonFence[0], "").replace(/\n{3,}/g, "\n\n").trim() ||
            content;
          return { content, suggestions };
        }
        suggestions.push({
          title: "Invalid patch",
          body: ps.error.message,
          patchError: ps.error,
          legacyDisplayOnly: false,
        });
        content =
          raw.replace(jsonFence[0], "").replace(/\n{3,}/g, "\n\n").trim() ||
          content;
        return { content, suggestions };
      }

      for (const s of parsed.suggestions ?? []) {
        if (s.body) {
          suggestions.push({
            path: s.path,
            title: s.title || s.path || "suggestion",
            body: s.body,
            status: "pending",
            legacyDisplayOnly: true,
            patchError: {
              code: "INVALID_PATCH",
              message:
                "Legacy suggestion format — display only. Use patchSet with replace_text.",
            },
          });
        }
      }
      if (suggestions.length) {
        content =
          raw.replace(jsonFence[0], "").replace(/\n{3,}/g, "\n\n").trim() ||
          content;
        return { content, suggestions };
      }
    } catch {
      /* fall through */
    }
  }

  const patchFenceRe = /```patch\s*([\s\S]*?)```/gi;
  let stripped = raw;
  let pm: RegExpExecArray | null;
  while ((pm = patchFenceRe.exec(raw)) !== null) {
    try {
      const parsed = JSON.parse(pm[1]!.trim()) as unknown;
      const ps = parsePatchSet(parsed);
      if (ps.ok) {
        suggestions.push(suggestionFromPatchSet(ps.patchSet));
      } else {
        suggestions.push({
          title: "Invalid patch",
          body: ps.error.message,
          patchError: ps.error,
        });
      }
    } catch {
      suggestions.push({
        title: "Invalid patch",
        body: "Could not parse ```patch JSON",
        patchError: {
          code: "INVALID_PATCH",
          message: "Could not parse ```patch JSON",
        },
      });
    }
    stripped = stripped.replace(pm[0], "");
  }

  if (suggestions.length) {
    content = stripped.replace(/\n{3,}/g, "\n\n").trim() || content;
    return { content, suggestions };
  }

  const fenceRe = /```suggestion\s*([\s\S]*?)```/gi;
  stripped = raw;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    const parsed = parseLegacySuggestionFence(m[1] ?? "");
    if (parsed) suggestions.push(parsed);
    stripped = stripped.replace(m[0], "");
  }

  if (suggestions.length) {
    content = stripped.replace(/\n{3,}/g, "\n\n").trim() || content;
  }

  return { content, suggestions };
}

function suggestionFromPatchSet(patchSet: PatchSet): ChatSuggestion {
  return {
    title: patchSet.summary,
    body: patchSet.summary,
    path: patchSet.operations[0]?.path,
    status: "pending",
    patchSet,
    legacyDisplayOnly: false,
  };
}

function parseLegacySuggestionFence(inner: string): ChatSuggestion | null {
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
      legacyDisplayOnly: true,
      patchError: {
        code: "INVALID_PATCH",
        message:
          "Legacy suggestion format — display only. Use ```patch with replace_text.",
      },
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
      legacyDisplayOnly: true,
      patchError: {
        code: "INVALID_PATCH",
        message:
          "Legacy suggestion format — display only. Use ```patch with replace_text.",
      },
    };
  }

  return null;
}
