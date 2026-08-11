import type {
  ChatMessage,
  ChatRole,
  ConversationArtifact,
  ConversationArtifactKind,
} from "../types/chat";

const ARTIFACT_KINDS = new Set<ConversationArtifactKind>([
  "block", "line", "list-item", "quoted", "emphasis", "assignment-value",
]);

function stableTextHash(value: string): string {
  // Synchronous FNV-1a 64-bit is sufficient for stable slice integrity here.
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function trimRange(text: string, start: number, end: number): { start: number; end: number } | null {
  while (start < end && /\s/.test(text[start] ?? "")) start += 1;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
  return end > start ? { start, end } : null;
}

function stripOuterMarkup(text: string, start: number, end: number): { start: number; end: number } {
  const pairs: Array<[string, string]> = [
    ["**", "**"], ["__", "__"], ["*", "*"], ["_", "_"], ["`", "`"],
    ["“", "”"], ["‘", "’"], ["\"", "\""], ["'", "'"], ["《", "》"],
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of pairs) {
      if (text.slice(start, start + open.length) === open && text.slice(end - close.length, end) === close) {
        start += open.length;
        end -= close.length;
        const trimmed = trimRange(text, start, end);
        if (trimmed) ({ start, end } = trimmed);
        changed = true;
        break;
      }
    }
  }
  return { start, end };
}

export function artifactTextHash(text: string): string {
  return stableTextHash(text);
}

export function buildConversationArtifacts(args: {
  messageId: string;
  role: ChatRole;
  content: string;
}): ConversationArtifact[] {
  const { messageId, role, content } = args;
  const candidates: Array<{ kind: ConversationArtifactKind; start: number; end: number }> = [];
  const add = (kind: ConversationArtifactKind, rawStart: number, rawEnd: number, strip = false) => {
    const trimmed = trimRange(content, rawStart, rawEnd);
    if (!trimmed) return;
    const range = strip ? stripOuterMarkup(content, trimmed.start, trimmed.end) : trimmed;
    if (range.end <= range.start) return;
    candidates.push({ kind, ...range });
  };

  for (const match of content.matchAll(/[^\r\n]+/g)) {
    if (match.index === undefined) continue;
    const start = match.index;
    const end = start + match[0].length;
    add("line", start, end);
    const prefix = match[0].match(/^\s*(?:[-+*]|\d+[.)])\s+/)?.[0];
    if (prefix) add("list-item", start + prefix.length, end, true);
  }

  for (const match of content.matchAll(/(?:^|\r?\n)([^\r\n]+(?:\r?\n(?!\s*\r?\n)[^\r\n]+)*)/g)) {
    if (match.index === undefined || match[1] === undefined) continue;
    const offset = match[0].indexOf(match[1]);
    add("block", match.index + offset, match.index + offset + match[1].length);
  }

  const inlinePatterns: Array<{ kind: ConversationArtifactKind; pattern: RegExp }> = [
    { kind: "emphasis", pattern: /\*\*([^*\r\n]+)\*\*|__([^_\r\n]+)__|\*([^*\r\n]+)\*|_([^_\r\n]+)_|`([^`\r\n]+)`/g },
    { kind: "quoted", pattern: /“([^”\r\n]+)”|‘([^’\r\n]+)’|《([^》\r\n]+)》|"([^"\r\n]+)"|'([^'\r\n]+)'/g },
  ];
  for (const { kind, pattern } of inlinePatterns) {
    for (const match of content.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const captured = match.slice(1).find((value) => value !== undefined);
      if (!captured) continue;
      const inner = match[0].indexOf(captured);
      add(kind, match.index + inner, match.index + inner + captured.length);
    }
  }

  const assignmentPatterns = [
    /(?:修改|替换|更新|改写|设置|设为|改为|改成|换成|定稿为|写入|填入|采用|使用)(?:[^\r\n：:]{0,32}?)(?:为|成|：|:)\s*(.+)$/gim,
    /(?:set|change|replace|rewrite|update|write|insert|apply|use)(?:[^\r\n:]{0,48}?)(?:\s+(?:to|with|as)|:)\s+(.+)$/gim,
  ];
  for (const pattern of assignmentPatterns) {
    for (const match of content.matchAll(pattern)) {
      if (match.index === undefined || !match[1]) continue;
      const inner = match[0].lastIndexOf(match[1]);
      add("assignment-value", match.index + inner, match.index + inner + match[1].length, true);
    }
  }

  const seen = new Set<string>();
  const artifacts: ConversationArtifact[] = [];
  for (const candidate of candidates) {
    const text = content.slice(candidate.start, candidate.end);
    if (!text.trim() || text.length > 80_000) continue;
    const key = `${candidate.kind}:${candidate.start}:${candidate.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const textHash = stableTextHash(text);
    artifacts.push({
      id: `artifact:${encodeURIComponent(messageId)}:${candidate.kind}:${candidate.start}:${candidate.end}:${textHash}`,
      messageId,
      role,
      kind: candidate.kind,
      start: candidate.start,
      end: candidate.end,
      text,
      textHash,
    });
  }
  return artifacts;
}

export function withConversationArtifacts(message: ChatMessage): ChatMessage {
  if (message.pending) return message;
  return {
    ...message,
    artifacts: buildConversationArtifacts({
      messageId: message.id,
      role: message.role,
      content: message.content,
    }),
  };
}

export function conversationArtifacts(messages: readonly ChatMessage[]): ConversationArtifact[] {
  return messages.flatMap((message) =>
    message.artifacts?.length
      ? message.artifacts
      : buildConversationArtifacts({ messageId: message.id, role: message.role, content: message.content }),
  );
}

export function validateConversationArtifact(artifact: unknown): artifact is ConversationArtifact {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return false;
  const value = artifact as Partial<ConversationArtifact>;
  if (!(
    typeof value.id === "string" &&
    typeof value.messageId === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.kind === "string" && ARTIFACT_KINDS.has(value.kind as ConversationArtifactKind) &&
    Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) &&
    (value.start ?? -1) >= 0 &&
    typeof value.text === "string" &&
    typeof value.textHash === "string" &&
    (value.end ?? 0) > (value.start ?? 0) &&
    (value.end ?? 0) - (value.start ?? 0) === value.text.length &&
    value.textHash === stableTextHash(value.text)
  )) return false;
  const expectedId = `artifact:${encodeURIComponent(value.messageId)}:${value.kind}:${value.start}:${value.end}:${value.textHash}`;
  return value.id === expectedId;
}
