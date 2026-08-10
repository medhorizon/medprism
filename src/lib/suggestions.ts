import { applyPatchSet, undoPatchSet } from "./patch/apply";
import type { PatchValidationError } from "./patch/schema";
import { validatePatchSet } from "./patch/validate";
import type { ChatMessage, ChatSuggestion } from "../types/chat";

export async function enrichSuggestion(
  suggestion: ChatSuggestion,
  files: Record<string, string>,
): Promise<ChatSuggestion> {
  if (!suggestion.patchSet) {
    return {
      ...suggestion,
      legacyDisplayOnly: true,
      patchError:
        suggestion.patchError ?? {
          code: "INVALID_PATCH",
          message: "Legacy suggestion is display-only. Regenerate it as a typed patch.",
        },
    };
  }

  const validated = await validatePatchSet(files, suggestion.patchSet);
  if (!validated.ok) {
    return {
      ...suggestion,
      status: suggestion.status ?? "pending",
      patchError: validated.error,
      previews: undefined,
    };
  }
  return {
    ...suggestion,
    status: suggestion.status ?? "pending",
    patchError: undefined,
    previews: validated.simulation.changes,
    path: suggestion.path ?? validated.simulation.affectedPaths[0],
  };
}

export type ApplySuggestionResult =
  | {
      ok: true;
      files: Record<string, string>;
      target: string;
      affectedPaths: string[];
      previousFiles: NonNullable<ChatSuggestion["previousFiles"]>;
      postApplyHashes: Record<string, string>;
      previews: NonNullable<ChatSuggestion["previews"]>;
      baseProjectRevision: string;
      nextProjectRevision: string;
    }
  | { ok: false; error: PatchValidationError };

export async function applySuggestionToFiles(
  files: Record<string, string>,
  message: ChatMessage,
): Promise<ApplySuggestionResult> {
  const suggestion = message.suggestion;
  if (!suggestion?.patchSet || suggestion.legacyDisplayOnly) {
    return {
      ok: false,
      error: {
        code: "INVALID_PATCH",
        message: "Suggestion does not contain a Keep-eligible typed patch",
      },
    };
  }

  const applied = await applyPatchSet(files, suggestion.patchSet);
  if (!applied.ok) return applied;
  const simulation = applied.simulation;
  return {
    ok: true,
    files: simulation.nextFiles,
    target: simulation.affectedPaths.find((path) => path.toLowerCase().endsWith(".tex")) ??
      simulation.affectedPaths[0]!,
    affectedPaths: simulation.affectedPaths,
    previousFiles: simulation.snapshots,
    postApplyHashes: simulation.postApplyHashes,
    previews: simulation.changes,
    baseProjectRevision: simulation.baseProjectRevision,
    nextProjectRevision: simulation.nextProjectRevision,
  };
}

export async function undoSuggestionInFiles(
  files: Record<string, string>,
  suggestion: ChatSuggestion,
) {
  if (!suggestion.previousFiles || !suggestion.postApplyHashes) {
    return {
      ok: false as const,
      error: {
        code: "INVALID_PATCH" as const,
        message: "Undo snapshot is unavailable",
      },
    };
  }
  return undoPatchSet(files, suggestion.previousFiles, suggestion.postApplyHashes);
}

export function withSuggestionStatus(
  messages: ChatMessage[],
  id: string,
  patch: Partial<ChatSuggestion>,
): ChatMessage[] {
  return messages.map((message) =>
    message.id === id && message.suggestion
      ? { ...message, suggestion: { ...message.suggestion, ...patch } }
      : message,
  );
}
