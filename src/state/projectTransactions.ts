import { applySuggestionToFiles, undoSuggestionInFiles } from "../lib/suggestions";
import { projectRevision } from "../lib/patch/revision";
import type { PatchValidationError } from "../lib/patch/schema";
import type { ChatMessage, ChatSuggestion } from "../types/chat";

export type VersionedProject = {
  id: string;
  revision: number;
  files: Record<string, string>;
};

export type ProjectTransactionResult<T extends VersionedProject> =
  | {
      ok: true;
      project: T;
      suggestionPatch: Partial<ChatSuggestion>;
      verifyCompile: boolean;
      target?: string;
    }
  | { ok: false; error: PatchValidationError };

/**
 * Compare-and-swap boundary for async Keep. The project is re-read after all
 * hashes/simulation complete, so a stale React closure cannot overwrite typing.
 */
export async function keepSuggestionTransaction<T extends VersionedProject>(args: {
  getCurrent: () => T | null;
  commit: (next: T, expectedRevision: number) => Promise<T> | T;
  message: ChatMessage;
}): Promise<ProjectTransactionResult<T>> {
  const start = args.getCurrent();
  if (!start) {
    return { ok: false, error: { code: "FILE_NOT_FOUND", message: "Project is unavailable" } };
  }
  const startContentRevision = await projectRevision(start.files);
  const applied = await applySuggestionToFiles(start.files, args.message);
  if (!applied.ok) return applied;

  const latest = args.getCurrent();
  if (!latest) {
    return { ok: false, error: { code: "FILE_NOT_FOUND", message: "Project is unavailable" } };
  }
  const latestContentRevision = await projectRevision(latest.files);
  if (
    latest.revision !== start.revision ||
    latestContentRevision !== startContentRevision ||
    applied.baseProjectRevision !== startContentRevision
  ) {
    return {
      ok: false,
      error: {
        code: "PROJECT_REVISION_MISMATCH",
        message: "Project changed while the patch was being prepared; regenerate the patch",
      },
    };
  }

  const committed = await args.commit(
    { ...latest, files: applied.files, revision: latest.revision + 1 } as T,
    latest.revision,
  );
  return {
    ok: true,
    project: committed,
    target: applied.target,
    verifyCompile: args.message.suggestion?.patchSet?.verify?.compile === true,
    suggestionPatch: {
      status: "applied",
      appliedTo: applied.target,
      previousFiles: applied.previousFiles,
      postApplyHashes: applied.postApplyHashes,
      previews: applied.previews,
      appliedProjectRevision: applied.nextProjectRevision,
      patchError: undefined,
    },
  };
}

export async function undoSuggestionTransaction<T extends VersionedProject>(args: {
  getCurrent: () => T | null;
  commit: (next: T, expectedRevision: number) => Promise<T> | T;
  suggestion: ChatSuggestion;
}): Promise<ProjectTransactionResult<T>> {
  const start = args.getCurrent();
  if (!start) {
    return { ok: false, error: { code: "FILE_NOT_FOUND", message: "Project is unavailable" } };
  }
  const startRevision = start.revision;
  const startContentRevision = await projectRevision(start.files);
  const undone = await undoSuggestionInFiles(start.files, args.suggestion);
  if (!undone.ok) return undone;

  const latest = args.getCurrent();
  if (!latest || latest.revision !== startRevision || (await projectRevision(latest.files)) !== startContentRevision) {
    return {
      ok: false,
      error: {
        code: "PROJECT_REVISION_MISMATCH",
        message: "Project changed while Undo was being prepared",
      },
    };
  }

  const committed = await args.commit(
    { ...latest, files: undone.files, revision: latest.revision + 1 } as T,
    latest.revision,
  );
  return {
    ok: true,
    project: committed,
    verifyCompile: false,
    suggestionPatch: {
      status: "undone",
      previousFiles: undefined,
      postApplyHashes: undefined,
      appliedProjectRevision: undefined,
      appliedTo: undefined,
    },
  };
}
