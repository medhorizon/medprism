import type { ChatRequestMessage } from "../llmClient";
import { firstRootCompileError } from "../../tools/parseCompileLog";
import { assertSafeProjectRelativePath } from "../projectPath";
import { isBinaryFileContent } from "../projectBinary";
import { sha256Hex } from "../patch/hash";
import { projectRevision } from "../patch/revision";
import { taggedPromptData } from "../promptData";
import { MAX_PROJECT_MEMORY_CHARS } from "../projectMemory";

export const CONTEXT_PACKAGE_VERSION = "1" as const;
const TEXT_RESOURCE_LIMIT = 40_000;
const COMPILE_LOG_LIMIT = 30_000;

export type TextSelection = { start: number; end: number };

export type ConversationContext = {
  confirmedImagePaths?: string[];
  taskGoal?: string;
  anchors?: string[];
};

export type ContextInput = {
  projectId: string;
  files: Record<string, string>;
  mainFile?: string;
  activeFile?: string;
  cursor?: number;
  selection?: TextSelection;
  lastCompileLog?: string;
  /** Optional durable project notes injected into model context. */
  memoryNotes?: string;
  conversationContext?: ConversationContext;
};

export type ContextFileKind =
  | "tex"
  | "bib"
  | "image"
  | "template"
  | "instructions"
  | "other";

export type ContextSnapshot = {
  schemaVersion: typeof CONTEXT_PACKAGE_VERSION;
  projectId: string;
  projectRevision: string;
  files: Readonly<Record<string, string>>;
  fileTree: ReadonlyArray<{ path: string; kind: ContextFileKind; size: number }>;
  mainFile?: string;
  mainDocument?: { path: string; content: string };
  activeFile: string;
  activeFileSha256: string;
  cursor: number;
  selection?: TextSelection;
  selectedText?: string;
  localContext: string;
  bibliographies: ReadonlyArray<{ path: string; content: string; truncated: boolean }>;
  compile: { log: string; rootDiagnostic: ReturnType<typeof firstRootCompileError> | null };
  resources: ReadonlyArray<{
    path: string;
    kind: "image" | "template" | "instructions";
    exists: true;
    content?: string;
    truncated?: boolean;
  }>;
  conversation: {
    confirmedImagePaths: string[];
    taskGoal: string | null;
    anchors: string[];
  };
  lastCompileLog?: string;
  memoryNotes?: string;
};

export type ContextPackage = ContextSnapshot;

export class ContextSnapshotError extends Error {
  readonly code: "NO_ACTIVE_FILE" | "INVALID_SELECTION" | "INVALID_CURSOR" | "INVALID_MAIN_FILE";

  constructor(code: ContextSnapshotError["code"], message: string) {
    super(message);
    this.name = "ContextSnapshotError";
    this.code = code;
  }
}

function chooseActiveFile(input: ContextInput): string {
  const candidate =
    input.activeFile ??
    input.mainFile ??
    Object.keys(input.files).find((path) => /(^|\/)main\.tex$/i.test(path)) ??
    Object.keys(input.files).find((path) => path.toLowerCase().endsWith(".tex")) ??
    Object.keys(input.files)[0];
  if (!candidate) throw new ContextSnapshotError("NO_ACTIVE_FILE", "Project has no files");
  const path = assertSafeProjectRelativePath(candidate);
  if (!(path in input.files)) {
    throw new ContextSnapshotError("NO_ACTIVE_FILE", `Active file not found: ${path}`);
  }
  return path;
}

function chooseMainFile(input: ContextInput, activeFile: string): string | undefined {
  const candidate =
    input.mainFile ??
    Object.keys(input.files).find((path) => /(^|\/)main\.tex$/i.test(path)) ??
    (activeFile.toLowerCase().endsWith(".tex") ? activeFile : undefined);
  if (!candidate) return undefined;
  const path = assertSafeProjectRelativePath(candidate);
  if (!(path in input.files) || !path.toLowerCase().endsWith(".tex")) {
    throw new ContextSnapshotError("INVALID_MAIN_FILE", `Main TeX file not found: ${path}`);
  }
  return path;
}

function localExcerpt(content: string, cursor: number, selection?: TextSelection, radius = 1200): string {
  const startAt = selection?.start ?? cursor;
  const endAt = selection?.end ?? cursor;
  const start = Math.max(0, startAt - radius);
  const end = Math.min(content.length, endAt + radius);
  return content.slice(start, end);
}

function fileKind(path: string): ContextFileKind {
  if (/\.(?:png|jpe?g|gif|svg|webp|tiff?|eps|pdf)$/i.test(path)) return "image";
  if (/\.bib$/i.test(path)) return "bib";
  if (/\.(?:cls|sty|bst)$/i.test(path)) return "template";
  if (/(?:^|\/)(?:readme|instructions?|guide|manual)(?:\.|$)/i.test(path) || /\.(?:md|txt)$/i.test(path)) {
    return "instructions";
  }
  if (/\.tex$/i.test(path)) return "tex";
  return "other";
}

function textResource(content: string): { content: string; truncated: boolean } {
  if (isBinaryFileContent(content)) return { content: "", truncated: true };
  return {
    content: content.slice(0, TEXT_RESOURCE_LIMIT),
    truncated: content.length > TEXT_RESOURCE_LIMIT,
  };
}

function normalizedConversation(
  value: ConversationContext | undefined,
  files: Readonly<Record<string, string>>,
): ContextSnapshot["conversation"] {
  const confirmedImagePaths = [...new Set(value?.confirmedImagePaths ?? [])]
    .map(assertSafeProjectRelativePath)
    .filter((path) => fileKind(path) === "image" && path in files)
    .sort();
  return {
    confirmedImagePaths,
    taskGoal: value?.taskGoal?.trim() || null,
    anchors: [...new Set((value?.anchors ?? []).map((anchor) => anchor.trim()).filter(Boolean))],
  };
}

export function deriveConversationContext(args: {
  history: ChatRequestMessage[];
  userText: string;
  files: Record<string, string>;
  existing?: ConversationContext;
}): ConversationContext {
  const recentText = [
    ...args.history.slice(-12).map((message) => message.content),
    args.userText,
  ].join("\n");
  const mentionedImages = Object.keys(args.files).filter(
    (path) => fileKind(path) === "image" && recentText.includes(path),
  );
  const sourceAnchors = [...recentText.matchAll(
    /\\(?:section|subsection|subsubsection|begin|end|label)\*?(?:\[[^\]]*\])?\{[^}\r\n]+\}/g,
  )].map((match) => match[0]);
  const confirmedAnchors = sourceAnchors.filter((anchor) =>
    Object.values(args.files).some((content) => !isBinaryFileContent(content) && content.includes(anchor)),
  );
  return {
    confirmedImagePaths: [
      ...(args.existing?.confirmedImagePaths ?? []),
      ...mentionedImages,
    ],
    taskGoal: args.userText.trim() || args.existing?.taskGoal,
    anchors: [...(args.existing?.anchors ?? []), ...confirmedAnchors],
  };
}

export async function buildContextSnapshot(input: ContextInput): Promise<ContextSnapshot> {
  const canonicalFiles: Record<string, string> = {};
  for (const [rawPath, content] of Object.entries(input.files)) {
    const path = assertSafeProjectRelativePath(rawPath);
    canonicalFiles[path] = content;
  }
  const files = Object.freeze(canonicalFiles);
  const activeFile = chooseActiveFile({ ...input, files });
  const mainFile = chooseMainFile({ ...input, files }, activeFile);
  const content = files[activeFile]!;
  let selection: TextSelection | undefined;
  let selectedText: string | undefined;

  if (input.selection) {
    const { start, end } = input.selection;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > content.length) {
      throw new ContextSnapshotError("INVALID_SELECTION", `Selection ${start}-${end} is outside ${activeFile}`);
    }
    if (start !== end) {
      selection = { start, end };
      selectedText = content.slice(start, end);
    }
  }

  const cursor = input.cursor ?? selection?.end ?? 0;
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > content.length) {
    throw new ContextSnapshotError("INVALID_CURSOR", `Cursor ${cursor} is outside ${activeFile}`);
  }

  const fileTree = Object.keys(files).sort().map((path) => ({
    path,
    kind: fileKind(path),
    size: files[path]!.length,
  }));
  const bibliographies = fileTree
    .filter((file) => file.kind === "bib")
    .map(({ path }) => ({ path, ...textResource(files[path]!) }));
  const resources: Array<ContextSnapshot["resources"][number]> = [];
  for (const { path, kind } of fileTree) {
    if (kind !== "image" && kind !== "template" && kind !== "instructions") continue;
    if (kind === "image") resources.push({ path, kind, exists: true });
    else resources.push({ path, kind, exists: true, ...textResource(files[path]!) });
  }
  const log = (input.lastCompileLog ?? "").slice(-COMPILE_LOG_LIMIT);
  const memoryNotes = input.memoryNotes?.replace(/\r\n?/g, "\n").trim();
  return {
    schemaVersion: CONTEXT_PACKAGE_VERSION,
    projectId: input.projectId,
    projectRevision: await projectRevision(files),
    files,
    fileTree,
    ...(mainFile ? { mainFile, mainDocument: { path: mainFile, content: files[mainFile]! } } : {}),
    activeFile,
    activeFileSha256: await sha256Hex(content),
    cursor,
    ...(selection ? { selection } : {}),
    ...(selectedText !== undefined ? { selectedText } : {}),
    localContext: localExcerpt(content, cursor, selection),
    bibliographies,
    compile: { log, rootDiagnostic: firstRootCompileError(log) ?? null },
    resources,
    conversation: normalizedConversation(input.conversationContext, files),
    ...(log ? { lastCompileLog: log } : {}),
    ...(memoryNotes ? { memoryNotes: memoryNotes.slice(0, MAX_PROJECT_MEMORY_CHARS) } : {}),
  };
}

export const buildContextPackage = buildContextSnapshot;

export function formatWorkspaceContext(snapshot: ContextSnapshot): string {
  return taggedPromptData("workspace_context", 'schemaVersion="1" trust="untrusted-data"', {
    schemaVersion: snapshot.schemaVersion,
    projectRevision: snapshot.projectRevision,
    fileTree: snapshot.fileTree,
    mainDocument: snapshot.mainDocument ?? null,
    editor: {
      activeFile: snapshot.activeFile,
      cursor: snapshot.cursor,
      selection: snapshot.selection ?? null,
      selectedText: snapshot.selectedText ?? null,
      localSourceContext: snapshot.localContext,
    },
    bibliographies: snapshot.bibliographies,
    compile: snapshot.compile,
    resources: snapshot.resources,
    conversation: snapshot.conversation,
    ...(snapshot.memoryNotes ? { projectMemoryNotes: snapshot.memoryNotes } : {}),
  });
}

export const formatContextPackage = formatWorkspaceContext;

export function injectContextPackage(
  messages: ChatRequestMessage[],
  snapshot: ContextSnapshot,
): ChatRequestMessage[] {
  const context = formatContextPackage(snapshot);
  const firstNonSystem = messages.findIndex((message) => message.role !== "system");
  const index = firstNonSystem < 0 ? messages.length : firstNonSystem;
  return [
    ...messages.slice(0, index),
    { role: "user", content: context },
    ...messages.slice(index),
  ];
}
