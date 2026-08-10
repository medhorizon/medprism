import { assertSafeProjectRelativePath } from "../projectPath";
import type { ContextSnapshot } from "../context/snapshot";
import { sha256Hex } from "./hash";
import type {
  EditOperation,
  ModelPatchProposal,
  PatchSet,
  PatchValidationError,
} from "./schema";

export type HydratePatchResult =
  | { ok: true; patchSet: PatchSet }
  | { ok: false; error: PatchValidationError };

export async function hydratePatchProposal(
  proposal: ModelPatchProposal,
  snapshot: ContextSnapshot,
  options: {
    strictSelection?: boolean;
    allowedPaths?: string[];
    forceCompileVerification?: boolean;
  } = {},
): Promise<HydratePatchResult> {
  const allowed = new Set(
    (options.allowedPaths ?? [snapshot.activeFile]).map(assertSafeProjectRelativePath),
  );
  const operations: EditOperation[] = [];

  for (let index = 0; index < proposal.operations.length; index += 1) {
    const proposed = proposal.operations[index]!;
    const path = assertSafeProjectRelativePath(proposed.path ?? snapshot.activeFile);
    if (!allowed.has(path)) {
      return {
        ok: false,
        error: {
          code: "UNSAFE_PATH",
          message: `Workflow is not allowed to edit ${path}`,
          operationIndex: index,
          path,
        },
      };
    }
    const content = snapshot.files[path];
    if (content === undefined) {
      return {
        ok: false,
        error: {
          code: "FILE_NOT_FOUND",
          message: `File not found: ${path}`,
          operationIndex: index,
          path,
        },
      };
    }
    const baseSha256 = await sha256Hex(content);

    if (proposed.op === "replace_text") {
      if (options.strictSelection && snapshot.selection) {
        if (path !== snapshot.activeFile || proposed.oldText !== snapshot.selectedText) {
          return {
            ok: false,
            error: {
              code: "RANGE_MISMATCH",
              message: "A selection-scoped edit must replace the exact selected text",
              operationIndex: index,
              path,
            },
          };
        }
      }
      operations.push({
        op: "replace_text",
        path,
        baseSha256,
        oldText: proposed.oldText,
        newText: proposed.newText,
        expectedOccurrences: 1,
        ...(options.strictSelection && snapshot.selection
          ? { range: { ...snapshot.selection } }
          : {}),
      });
      continue;
    }

    if (options.strictSelection) {
      return {
        ok: false,
        error: {
          code: "RANGE_MISMATCH",
          message: "Selection-scoped model output must use replace_text",
          operationIndex: index,
          path,
        },
      };
    }
    operations.push({
      op: proposed.op,
      path,
      baseSha256,
      anchor: proposed.anchor,
      text: proposed.text,
      expectedOccurrences: 1,
    });
  }

  return {
    ok: true,
    patchSet: {
      schemaVersion: "1",
      id: crypto.randomUUID(),
      projectRevision: snapshot.projectRevision,
      summary: proposal.summary,
      operations,
      verify: {
        compile: options.forceCompileVerification ?? false,
      },
    },
  };
}
