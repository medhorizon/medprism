import { assertSafeProjectRelativePath } from "../projectPath";
import { sha256Hex } from "../patch/hash";
import { projectRevision } from "../patch/revision";

export type TextSelection = { start: number; end: number };

export type ContextInput = {
  projectId: string;
  files: Record<string, string>;
  mainFile?: string;
  activeFile?: string;
  selection?: TextSelection;
  lastCompileLog?: string;
};

export type ContextSnapshot = {
  projectId: string;
  projectRevision: string;
  files: Readonly<Record<string, string>>;
  mainFile?: string;
  activeFile: string;
  activeFileSha256: string;
  selection?: TextSelection;
  selectedText?: string;
  localContext: string;
  lastCompileLog?: string;
};

export class ContextSnapshotError extends Error {
  readonly code: "NO_ACTIVE_FILE" | "INVALID_SELECTION";

  constructor(code: "NO_ACTIVE_FILE" | "INVALID_SELECTION", message: string) {
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

function localExcerpt(content: string, selection?: TextSelection, radius = 1200): string {
  if (!selection) return content.slice(0, radius * 2);
  const start = Math.max(0, selection.start - radius);
  const end = Math.min(content.length, selection.end + radius);
  return content.slice(start, end);
}

export async function buildContextSnapshot(input: ContextInput): Promise<ContextSnapshot> {
  const files = Object.freeze({ ...input.files });
  const activeFile = chooseActiveFile({ ...input, files });
  const content = files[activeFile]!;
  let selection: TextSelection | undefined;
  let selectedText: string | undefined;

  if (input.selection) {
    const { start, end } = input.selection;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > content.length
    ) {
      throw new ContextSnapshotError(
        "INVALID_SELECTION",
        `Selection ${start}-${end} is outside ${activeFile}`,
      );
    }
    if (start !== end) {
      selection = { start, end };
      selectedText = content.slice(start, end);
    }
  }

  return {
    projectId: input.projectId,
    projectRevision: await projectRevision(files),
    files,
    ...(input.mainFile ? { mainFile: assertSafeProjectRelativePath(input.mainFile) } : {}),
    activeFile,
    activeFileSha256: await sha256Hex(content),
    ...(selection ? { selection } : {}),
    ...(selectedText !== undefined ? { selectedText } : {}),
    localContext: localExcerpt(content, selection),
    ...(input.lastCompileLog ? { lastCompileLog: input.lastCompileLog } : {}),
  };
}

export function formatWorkspaceContext(snapshot: ContextSnapshot): string {
  const selectionBlock = snapshot.selection
    ? [
        `Selection range: ${snapshot.selection.start}-${snapshot.selection.end}`,
        `Selected text:\n${snapshot.selectedText ?? ""}`,
      ].join("\n")
    : "Selection: none";

  return [
    '<workspace_context trust="untrusted-data">',
    `Project revision: ${snapshot.projectRevision}`,
    `Active file: ${snapshot.activeFile}`,
    selectionBlock,
    `Local source context:\n${snapshot.localContext}`,
    snapshot.lastCompileLog
      ? `Last compile log (truncated):\n${snapshot.lastCompileLog.slice(0, 3000)}`
      : "Last compile log: none",
    "</workspace_context>",
  ].join("\n\n");
}
