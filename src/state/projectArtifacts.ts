import type { ChatMessage, ChatSuggestion } from "../types/chat";
import { normalizeProjectMemory } from "../lib/projectMemory";

export { MAX_PROJECT_MEMORY_CHARS, normalizeProjectMemory } from "../lib/projectMemory";

const CHAT_PREFIX = "medprism.projectChat.";
const PDF_PREFIX = "medprism.projectPdf.";
const MEMORY_PREFIX = "medprism.projectMemory.";
const CHAT_SCHEMA_VERSION = 1 as const;
const PDF_SCHEMA_VERSION = 1 as const;
const MEMORY_SCHEMA_VERSION = 1 as const;
const MAX_CHAT_MESSAGES = 80;

/** UI placeholders that must never be treated as a finished assistant reply. */
const THINKING_PLACEHOLDERS = new Set(["正在思考…", "Thinking…"]);

/** Default durable text when a pending reply is interrupted (e.g. project switch). */
export const CHAT_INTERRUPTED_FALLBACK =
  "Request interrupted. Send the message again.";

/** Replace in-flight / stale thinking placeholders before storage or hydrate. */
export function finalizeChatMessages(
  messages: ChatMessage[],
  interruptedContent: string = CHAT_INTERRUPTED_FALLBACK,
): ChatMessage[] {
  return messages.map((message) => {
    const stale =
      message.role === "assistant" &&
      (message.pending === true || THINKING_PLACEHOLDERS.has(message.content));
    if (!stale && message.pending === undefined) return message;
    const next: ChatMessage = {
      id: message.id,
      role: message.role,
      content: stale ? interruptedContent : message.content,
    };
    if (message.suggestion) next.suggestion = message.suggestion;
    return next;
  });
}

export type StoredProjectPdf = {
  schemaVersion: typeof PDF_SCHEMA_VERSION;
  filesRevision: string;
  pdfBase64: string;
  updatedAt: string;
};

export type StoredProjectChat = {
  schemaVersion: typeof CHAT_SCHEMA_VERSION;
  updatedAt: string;
  messages: ChatMessage[];
};

export type StoredProjectMemory = {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION;
  updatedAt: string;
  notes: string;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function chatKey(projectId: string): string {
  return `${CHAT_PREFIX}${projectId}`;
}

function pdfKey(projectId: string): string {
  return `${PDF_PREFIX}${projectId}`;
}

function memoryKey(projectId: string): string {
  return `${MEMORY_PREFIX}${projectId}`;
}

function isChatRole(value: unknown): value is ChatMessage["role"] {
  return value === "user" || value === "assistant";
}

function slimSuggestion(suggestion: ChatSuggestion | undefined): ChatSuggestion | undefined {
  if (!suggestion) return undefined;
  // Keep undo metadata for recent messages; storage layer may strip later on quota pressure.
  return { ...suggestion };
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.trim() || !isChatRole(raw.role) || typeof raw.content !== "string") {
    return null;
  }
  const message: ChatMessage = {
    id: raw.id,
    role: raw.role,
    content: raw.content,
  };
  if (raw.pending === true) message.pending = true;
  if (raw.suggestion && typeof raw.suggestion === "object") {
    message.suggestion = slimSuggestion(raw.suggestion as ChatSuggestion);
  }
  return message;
}

function normalizeChat(value: unknown): ChatMessage[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.messages)) return null;
  const messages: ChatMessage[] = [];
  for (const entry of raw.messages) {
    const message = normalizeMessage(entry);
    if (!message) return null;
    messages.push(message);
  }
  return messages;
}

/** Drop the heaviest undo snapshots from oldest assistant messages when quota is tight. */
function stripHeavySuggestionPayloads(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (!message.suggestion) return message;
    const { previousFiles: _previousFiles, postApplyHashes: _hashes, ...rest } = message.suggestion;
    return { ...message, suggestion: rest };
  });
}

function writeJson(storage: StorageLike, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadProjectChat(
  projectId: string,
  storage: StorageLike = localStorage,
  interruptedContent: string = CHAT_INTERRUPTED_FALLBACK,
): ChatMessage[] | null {
  if (!projectId.trim()) return null;
  try {
    const raw = storage.getItem(chatKey(projectId));
    if (!raw) return null;
    const messages = normalizeChat(JSON.parse(raw));
    return messages ? finalizeChatMessages(messages, interruptedContent) : null;
  } catch {
    return null;
  }
}

export function saveProjectChat(
  projectId: string,
  messages: ChatMessage[],
  storage: StorageLike = localStorage,
  interruptedContent: string = CHAT_INTERRUPTED_FALLBACK,
): boolean {
  if (!projectId.trim()) return false;
  const trimmed = finalizeChatMessages(messages, interruptedContent).slice(
    -MAX_CHAT_MESSAGES,
  );
  const payload: StoredProjectChat = {
    schemaVersion: CHAT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    messages: trimmed,
  };
  if (writeJson(storage, chatKey(projectId), payload)) return true;
  const slim: StoredProjectChat = {
    ...payload,
    messages: stripHeavySuggestionPayloads(trimmed),
  };
  return writeJson(storage, chatKey(projectId), slim);
}

export function loadProjectPdf(
  projectId: string,
  storage: StorageLike = localStorage,
): StoredProjectPdf | null {
  if (!projectId.trim()) return null;
  try {
    const raw = storage.getItem(pdfKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProjectPdf>;
    if (
      parsed.schemaVersion !== PDF_SCHEMA_VERSION ||
      typeof parsed.filesRevision !== "string" ||
      !parsed.filesRevision ||
      typeof parsed.pdfBase64 !== "string" ||
      !parsed.pdfBase64 ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return {
      schemaVersion: PDF_SCHEMA_VERSION,
      filesRevision: parsed.filesRevision,
      pdfBase64: parsed.pdfBase64,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function saveProjectPdf(
  projectId: string,
  filesRevision: string,
  pdfBase64: string,
  storage: StorageLike = localStorage,
): boolean {
  if (!projectId.trim() || !filesRevision || !pdfBase64) return false;
  const payload: StoredProjectPdf = {
    schemaVersion: PDF_SCHEMA_VERSION,
    filesRevision,
    pdfBase64,
    updatedAt: new Date().toISOString(),
  };
  return writeJson(storage, pdfKey(projectId), payload);
}

export function clearProjectPdf(
  projectId: string,
  storage: StorageLike = localStorage,
): void {
  if (!projectId.trim()) return;
  try {
    storage.removeItem(pdfKey(projectId));
  } catch {
    // ignore
  }
}

export function loadProjectMemory(
  projectId: string,
  storage: StorageLike = localStorage,
): string {
  if (!projectId.trim()) return "";
  try {
    const raw = storage.getItem(memoryKey(projectId));
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Partial<StoredProjectMemory>;
    if (
      parsed.schemaVersion !== MEMORY_SCHEMA_VERSION ||
      typeof parsed.notes !== "string"
    ) {
      return "";
    }
    return normalizeProjectMemory(parsed.notes);
  } catch {
    return "";
  }
}

export function saveProjectMemory(
  projectId: string,
  notes: string,
  storage: StorageLike = localStorage,
): boolean {
  if (!projectId.trim()) return false;
  const normalized = normalizeProjectMemory(notes);
  if (!normalized) {
    try {
      storage.removeItem(memoryKey(projectId));
      return true;
    } catch {
      return false;
    }
  }
  const payload: StoredProjectMemory = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    notes: normalized,
  };
  return writeJson(storage, memoryKey(projectId), payload);
}

export function clearProjectMemory(
  projectId: string,
  storage: StorageLike = localStorage,
): void {
  if (!projectId.trim()) return;
  try {
    storage.removeItem(memoryKey(projectId));
  } catch {
    // ignore
  }
}

export function clearProjectArtifacts(
  projectId: string,
  storage: StorageLike = localStorage,
): void {
  if (!projectId.trim()) return;
  try {
    storage.removeItem(chatKey(projectId));
  } catch {
    // ignore
  }
  clearProjectPdf(projectId, storage);
  clearProjectMemory(projectId, storage);
}
