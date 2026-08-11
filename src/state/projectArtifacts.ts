import type {
  ChatConfirmation,
  ChatDisambiguation,
  ChatExecution,
  ChatMessage,
  ChatSuggestion,
  PendingDisambiguationTask,
  PendingDisambiguationTaskStatus,
  PendingFileTask,
  PendingFileTaskStatus,
} from "../types/chat";
import { normalizeProjectMemory } from "../lib/projectMemory";
import { conversationArtifacts, validateConversationArtifact, withConversationArtifacts } from "../lib/conversationArtifacts";
import { parseTaskSpec } from "../lib/task/schema";

export { MAX_PROJECT_MEMORY_CHARS, normalizeProjectMemory } from "../lib/projectMemory";

const CHAT_PREFIX = "medprism.projectChat.";
const PDF_PREFIX = "medprism.projectPdf.";
const MEMORY_PREFIX = "medprism.projectMemory.";
const CHAT_SCHEMA_VERSION = 2 as const;
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
    if (!stale && message.pending === undefined) return withConversationArtifacts(message);
    const next: ChatMessage = {
      id: message.id,
      role: message.role,
      content: stale ? interruptedContent : message.content,
    };
    if (message.suggestion) next.suggestion = message.suggestion;
    return withConversationArtifacts(next);
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

const PENDING_STATUSES = new Set<PendingFileTaskStatus>([
  "awaiting-confirmation", "confirmed", "cancelled", "superseded", "expired",
]);
const DISAMBIGUATION_STATUSES = new Set<PendingDisambiguationTaskStatus>([
  "awaiting-disambiguation", "selected", "cancelled", "superseded", "expired",
]);
const PENDING_OPERATIONS = new Set<PendingFileTask["targets"][number]["operation"]>([
  "generate", "replace", "insert", "scaffold", "cite", "repair",
]);
const TASK_ACTIONS = new Set([
  "advice", "draft", "polish", "scaffold", "fill-sections", "cite",
  "review", "research", "latex", "compile-fix",
]);

function normalizePendingTargets(value: unknown): PendingFileTask["targets"] | null {
  if (!Array.isArray(value)) return null;
  const targets: PendingFileTask["targets"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const target = entry as Record<string, unknown>;
    if (
      typeof target.id !== "string" || !target.id ||
      typeof target.slot !== "string" || !target.slot ||
      !PENDING_OPERATIONS.has(target.operation as PendingFileTask["targets"][number]["operation"]) ||
      (target.path !== undefined && typeof target.path !== "string") ||
      (target.preview !== undefined && typeof target.preview !== "string")
    ) return null;
    targets.push({
      id: target.id,
      slot: target.slot,
      operation: target.operation as PendingFileTask["targets"][number]["operation"],
      ...(typeof target.path === "string" ? { path: target.path } : {}),
      ...(typeof target.preview === "string" ? { preview: target.preview } : {}),
    });
  }
  return targets;
}

function normalizePendingSelection(value: unknown): PendingFileTask["selection"] | undefined | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selection = value as Record<string, unknown>;
  if (
    typeof selection.path !== "string" || !selection.path ||
    !Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end) ||
    Number(selection.start) < 0 || Number(selection.end) <= Number(selection.start) ||
    typeof selection.textHash !== "string" || !/^[0-9a-f]{16}$/.test(selection.textHash)
  ) return null;
  return {
    path: selection.path,
    start: Number(selection.start),
    end: Number(selection.end),
    textHash: selection.textHash,
  };
}

function normalizeConfirmation(value: unknown): ChatConfirmation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!PENDING_STATUSES.has(raw.status as PendingFileTaskStatus)) return undefined;
  if (!raw.task || typeof raw.task !== "object" || Array.isArray(raw.task)) return undefined;
  const task = raw.task as Record<string, unknown>;
  if (
    task.schemaVersion !== "1" ||
    typeof task.id !== "string" ||
    typeof task.projectId !== "string" ||
    typeof task.projectRevision !== "string" ||
    typeof task.createdAt !== "string" ||
    !PENDING_STATUSES.has(task.status as PendingFileTaskStatus) ||
    !Array.isArray(task.sources) ||
    !Array.isArray(task.targets)
  ) return undefined;
  if (raw.status !== task.status) return undefined;
  const sources = task.sources.filter(validateConversationArtifact);
  if (sources.length !== task.sources.length) return undefined;
  const parsed = parseTaskSpec(JSON.stringify(task.spec), sources.map((source) => source.id));
  if (!parsed.ok) return undefined;
  const targets = normalizePendingTargets(task.targets);
  const targetSelections = normalizeTargetSelections(task.targetSelections);
  const selection = normalizePendingSelection(task.selection);
  if (!targets || targetSelections === null || selection === null) return undefined;
  const normalizedTask: PendingFileTask = {
    schemaVersion: "1",
    id: task.id,
    projectId: task.projectId,
    projectRevision: task.projectRevision,
    createdAt: task.createdAt,
    status: task.status as PendingFileTaskStatus,
    spec: parsed.value,
    sources,
    ...(targetSelections?.length ? { targetSelections } : {}),
    targets,
    ...(selection ? { selection } : {}),
  };
  return { task: normalizedTask, status: raw.status as PendingFileTaskStatus };
}

function normalizeTargetSelections(value: unknown): PendingFileTask["targetSelections"] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const selections: NonNullable<PendingFileTask["targetSelections"]> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const raw = entry as Record<string, unknown>;
    if (
      !Number.isSafeInteger(raw.targetIndex) ||
      Number(raw.targetIndex) < 0 ||
      typeof raw.occurrenceId !== "string" ||
      !raw.occurrenceId
    ) return null;
    selections.push({
      targetIndex: Number(raw.targetIndex),
      occurrenceId: raw.occurrenceId,
    });
  }
  return selections;
}

function normalizeDisambiguationChoices(value: unknown): PendingDisambiguationTask["choices"] | null {
  if (!Array.isArray(value)) return null;
  const choices: PendingDisambiguationTask["choices"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const choice = entry as Record<string, unknown>;
    if (
      typeof choice.id !== "string" || !choice.id ||
      !Number.isSafeInteger(choice.targetIndex) || Number(choice.targetIndex) < 0 ||
      typeof choice.occurrenceId !== "string" || !choice.occurrenceId ||
      typeof choice.slot !== "string" || !choice.slot ||
      typeof choice.path !== "string" || !choice.path ||
      typeof choice.syntax !== "string" || !choice.syntax ||
      typeof choice.heading !== "string" ||
      (choice.preview !== undefined && typeof choice.preview !== "string")
    ) return null;
    choices.push({
      id: choice.id,
      targetIndex: Number(choice.targetIndex),
      occurrenceId: choice.occurrenceId,
      slot: choice.slot,
      path: choice.path,
      syntax: choice.syntax,
      heading: choice.heading,
      ...(typeof choice.preview === "string" ? { preview: choice.preview } : {}),
    });
  }
  return choices;
}

function normalizeDisambiguation(value: unknown): ChatDisambiguation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!DISAMBIGUATION_STATUSES.has(raw.status as PendingDisambiguationTaskStatus)) return undefined;
  if (!raw.task || typeof raw.task !== "object" || Array.isArray(raw.task)) return undefined;
  const task = raw.task as Record<string, unknown>;
  if (
    task.schemaVersion !== "1" ||
    typeof task.id !== "string" ||
    typeof task.projectId !== "string" ||
    typeof task.projectRevision !== "string" ||
    typeof task.createdAt !== "string" ||
    !DISAMBIGUATION_STATUSES.has(task.status as PendingDisambiguationTaskStatus) ||
    !Array.isArray(task.sources) ||
    !["llm", "locked", "runtime"].includes(String(task.taskSource)) ||
    typeof task.repaired !== "boolean" ||
    typeof task.explicitlyAuthorized !== "boolean"
  ) return undefined;
  if (raw.status !== task.status) return undefined;
  const sources = task.sources.filter(validateConversationArtifact);
  if (sources.length !== task.sources.length) return undefined;
  const parsed = parseTaskSpec(JSON.stringify(task.spec), sources.map((source) => source.id));
  if (!parsed.ok) return undefined;
  const choices = normalizeDisambiguationChoices(task.choices);
  const selection = normalizePendingSelection(task.selection);
  if (!choices || selection === null) return undefined;
  const normalizedTask: PendingDisambiguationTask = {
    schemaVersion: "1",
    id: task.id,
    projectId: task.projectId,
    projectRevision: task.projectRevision,
    createdAt: task.createdAt,
    status: task.status as PendingDisambiguationTaskStatus,
    spec: parsed.value,
    sources,
    taskSource: task.taskSource as PendingDisambiguationTask["taskSource"],
    repaired: task.repaired,
    explicitlyAuthorized: task.explicitlyAuthorized,
    choices,
    ...(selection ? { selection } : {}),
  };
  return { task: normalizedTask, status: raw.status as PendingDisambiguationTaskStatus };
}

function normalizeExecution(value: unknown): ChatExecution | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== "1" ||
    !["answer", "disambiguation-required", "confirmation-required", "patch-proposed", "blocked"].includes(String(raw.outcome)) ||
    !["llm", "locked", "runtime", "invalid", "resumed"].includes(String(raw.taskSource)) ||
    !Number.isSafeInteger(raw.targetCount) || Number(raw.targetCount) < 0 ||
    (raw.action !== undefined && !TASK_ACTIONS.has(String(raw.action))) ||
    (raw.failureCode !== undefined && typeof raw.failureCode !== "string")
  ) return undefined;
  return value as ChatExecution;
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
  const confirmation = normalizeConfirmation(raw.confirmation);
  if (confirmation) message.confirmation = confirmation;
  const disambiguation = normalizeDisambiguation(raw.disambiguation);
  if (disambiguation) message.disambiguation = disambiguation;
  const execution = normalizeExecution(raw.execution);
  if (execution) message.execution = execution;
  return withConversationArtifacts(message);
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
  const sourceById = new Map(conversationArtifacts(messages).map((artifact) => [artifact.id, artifact]));
  return messages.map((message) => {
    const confirmation = message.confirmation;
    const sourceTask = confirmation?.status === "awaiting-confirmation"
      ? confirmation.task
      : message.disambiguation?.status === "awaiting-disambiguation"
        ? message.disambiguation.task
        : null;
    if (!sourceTask) return message;
    const sourcesStillBound = sourceTask.sources.every((source) => {
      const actual = sourceById.get(source.id);
      return actual !== undefined &&
        actual.messageId === source.messageId &&
        actual.role === source.role &&
        actual.kind === source.kind &&
        actual.start === source.start &&
        actual.end === source.end &&
        actual.text === source.text &&
        actual.textHash === source.textHash;
    });
    if (sourcesStillBound) return message;
    if (message.disambiguation?.status === "awaiting-disambiguation") {
      return {
        ...message,
        disambiguation: {
          status: "expired",
          task: { ...message.disambiguation.task, status: "expired" },
        },
      };
    }
    if (!confirmation) return message;
    return {
      ...message,
      confirmation: {
        status: "expired",
        task: { ...confirmation.task, status: "expired" },
      },
    };
  });
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
