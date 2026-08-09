import { applyPatchSet, previewPatchSet, undoPatchSet } from "./patch/apply";
import { sha256Hex } from "./patch/hash";
import { validatePatchSet } from "./patch/validate";
import type { ChatMessage, ChatSuggestion } from "../types/chat";

/**
 * Enrich a parsed suggestion against current files: validate PatchSet,
 * attach previews, or mark legacy display-only (no Keep).
 */
export async function enrichSuggestion(
  suggestion: ChatSuggestion,
  files: Record<string, string>,
): Promise<ChatSuggestion> {
  if (!suggestion.patchSet) {
    return {
      ...suggestion,
      legacyDisplayOnly: true,
      patchError: {
        code: "INVALID_PATCH",
        message:
          "Legacy suggestion (no PatchSet). Display only — regenerate with replace_text / insert / bib_add.",
      },
      previews: undefined,
    };
  }

  const validated = await validatePatchSet(suggestion.patchSet, files);
  if (!validated.ok) {
    return {
      ...suggestion,
      legacyDisplayOnly: false,
      patchError: validated.error,
      previews: previewPatchSet(suggestion.patchSet, files),
    };
  }

  return {
    ...suggestion,
    legacyDisplayOnly: false,
    patchError: undefined,
    title: suggestion.title || suggestion.patchSet.summary,
    path: suggestion.path || suggestion.patchSet.operations[0]?.path,
    body: suggestion.body || suggestion.patchSet.summary,
    previews: previewPatchSet(suggestion.patchSet, files),
  };
}

export async function applySuggestionToFiles(
  files: Record<string, string>,
  message: ChatMessage,
): Promise<{
  files: Record<string, string>;
  target: string;
  previousFiles: Record<string, string>;
  postApplyHashes: Record<string, string>;
  previews: NonNullable<ChatSuggestion["previews"]>;
} | null> {
  const suggestion = message.suggestion;
  if (!suggestion) return null;
  if (suggestion.status === "applied") return null;
  if (!suggestion.patchSet || suggestion.legacyDisplayOnly || suggestion.patchError) {
    return null;
  }

  // Re-validate at Keep time (file may have changed since message was shown)
  const result = await applyPatchSet(suggestion.patchSet, files);
  if (!result.ok) return null;

  const postApplyHashes: Record<string, string> = {};
  for (const path of result.affectedPaths) {
    postApplyHashes[path] = await sha256Hex(result.files[path] ?? "");
  }

  return {
    files: result.files,
    target: result.affectedPaths[0]!,
    previousFiles: result.previousFiles,
    postApplyHashes,
    previews: result.previews,
  };
}

export async function undoSuggestionInFiles(
  files: Record<string, string>,
  suggestion: ChatSuggestion,
): Promise<
  | { ok: true; files: Record<string, string> }
  | { ok: false; reason: string }
> {
  if (
    suggestion.status !== "applied" ||
    !suggestion.previousFiles ||
    !suggestion.postApplyHashes
  ) {
    // Legacy single-file undo (pre-patch messages)
    if (
      suggestion.status === "applied" &&
      suggestion.appliedTo &&
      suggestion.previousContent != null
    ) {
      return {
        ok: true,
        files: {
          ...files,
          [suggestion.appliedTo]: suggestion.previousContent,
        },
      };
    }
    return { ok: false, reason: "Nothing to undo" };
  }

  const result = await undoPatchSet({
    files,
    previousFiles: suggestion.previousFiles,
    postApplyHashes: suggestion.postApplyHashes,
  });
  if (!result.ok) {
    return { ok: false, reason: result.error.message };
  }
  return { ok: true, files: result.files };
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

/** @deprecated basename guessing — kept only for tests of legacy helpers if any */
export function resolveSuggestionTarget(
  suggestion: { title?: string; path?: string; body?: string },
  files: Record<string, string>,
): string | undefined {
  const keys = Object.keys(files);
  if (!keys.length) return undefined;
  const explicit = suggestion.path?.replace(/\\/g, "/").replace(/^\.\//, "");
  if (explicit && explicit in files) return explicit;
  return undefined;
}
