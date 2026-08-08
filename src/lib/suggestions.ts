import type { ChatMessage } from "../types/chat";

export function resolveSuggestionTarget(
  suggestion: { title?: string; path?: string; body?: string },
  files: Record<string, string>,
): string | undefined {
  const keys = Object.keys(files);
  if (!keys.length) return undefined;

  const pick = (re: RegExp) =>
    keys.find((k) => re.test(k.replace(/\\/g, "/")));

  const explicit = suggestion.path?.replace(/\\/g, "/").replace(/^\.\//, "");
  if (explicit) {
    if (explicit in files) return explicit;
    const base = explicit.split("/").pop();
    if (base) {
      const byBase = keys.find((k) => k.replace(/\\/g, "/").endsWith("/" + base) || k === base);
      if (byBase) return byBase;
    }
  }

  const title = suggestion.title || "";
  if (/\.bib/i.test(title) || /bibtex|bibliograph/i.test(title)) {
    return pick(/\.bib$/i) ?? keys.find((k) => k.endsWith(".bib"));
  }
  if (/methods/i.test(title)) return pick(/methods\.tex$/i) ?? pick(/methods/i);
  if (/results/i.test(title)) return pick(/results\.tex$/i) ?? pick(/results/i);
  if (/abstract/i.test(title)) return pick(/abstract\.tex$/i) ?? pick(/abstract/i);
  if (/main\.tex/i.test(title)) return pick(/(^|\/)main\.tex$/i);

  // BibTeX body heuristic
  const body = suggestion.body || "";
  if (/^\s*@\w+\{/m.test(body)) {
    return pick(/\.bib$/i) ?? keys.find((k) => k.endsWith(".bib"));
  }

  return pick(/(^|\/)main\.tex$/i) ?? keys.find((k) => k.endsWith(".tex")) ?? keys[0];
}

function mergeSuggestionBody(previous: string, body: string, target: string): string {
  const trimmedBody = body.trim();
  if (target.endsWith(".bib")) {
    // Append BibTeX entries; avoid duplicating identical blocks
    if (previous.includes(trimmedBody)) return previous;
    return `${previous.trimEnd()}\n\n${trimmedBody}\n`;
  }
  return `${previous.trimEnd()}\n\n% --- MedPrism suggestion applied ---\n${trimmedBody}\n`;
}

export function applySuggestionToFiles(
  files: Record<string, string>,
  message: ChatMessage,
): {
  files: Record<string, string>;
  target: string;
  previousContent: string;
} | null {
  if (!message.suggestion) return null;
  if (message.suggestion.status === "applied") return null;

  const target = resolveSuggestionTarget(message.suggestion, files);
  if (!target) return null;

  // Create .bib if suggestion targets a missing bib path
  const pathHint = message.suggestion.path?.replace(/\\/g, "/");
  let nextFiles = { ...files };
  let resolved = target;
  if (!(resolved in nextFiles) && pathHint?.endsWith(".bib")) {
    nextFiles = { ...nextFiles, [pathHint]: "" };
    resolved = pathHint;
  }
  if (!(resolved in nextFiles)) return null;

  const previousContent = nextFiles[resolved] ?? "";
  const nextContent = mergeSuggestionBody(previousContent, message.suggestion.body, resolved);

  return {
    target: resolved,
    previousContent,
    files: { ...nextFiles, [resolved]: nextContent },
  };
}

export function withSuggestionStatus(
  messages: ChatMessage[],
  messageId: string,
  patch: Partial<NonNullable<ChatMessage["suggestion"]>>,
): ChatMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId || !m.suggestion) return m;
    return {
      ...m,
      suggestion: { ...m.suggestion, ...patch },
    };
  });
}
