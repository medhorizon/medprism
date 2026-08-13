import { assertSafeProjectRelativePath } from "../projectPath";
import type { ContextSnapshot } from "../context/snapshot";
import { sha256Hex } from "./hash";
import { resolveInsertPlacement } from "./insertAnchor";
import type {
  EditOperation,
  ModelPatchProposal,
  PatchSet,
  PatchValidationError,
} from "./schema";

export type HydratePatchResult =
  | { ok: true; patchSet: PatchSet }
  | { ok: false; error: PatchValidationError };

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index + 1);
}

function imageReferences(text: string): string[] {
  return [...text.matchAll(/\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/gi)]
    .map((match) => match[1]!.trim())
    .filter(Boolean);
}

function graphicPaths(source: string): string[] {
  return [...source.matchAll(/\\graphicspath\s*\{((?:\s*\{[^}]+\}\s*)+)\}/gi)]
    .flatMap((match) => [...match[1]!.matchAll(/\{([^}]+)\}/g)].map((entry) => entry[1]!.trim()))
    .filter(Boolean);
}

function imageCandidates(sourcePath: string, reference: string, source: string): string[] {
  const raw = reference.replace(/\\/g, "/");
  const based = `${dirname(sourcePath)}${raw}`;
  const candidates = [
    raw,
    based,
    ...graphicPaths(source).flatMap((directory) => [
      `${directory.replace(/\\/g, "/")}${raw}`,
      `${dirname(sourcePath)}${directory.replace(/\\/g, "/")}${raw}`,
    ]),
  ];
  if (!/\.[A-Za-z0-9]+$/.test(raw)) {
    const bases = [...candidates];
    for (const extension of [".pdf", ".png", ".jpg", ".jpeg", ".eps", ".svg"]) {
      candidates.push(...bases.map((candidate) => `${candidate}${extension}`));
    }
  }
  return [...new Set(candidates)].flatMap((candidate) => {
    try {
      return [assertSafeProjectRelativePath(candidate)];
    } catch {
      return [];
    }
  });
}

function missingImageReference(
  snapshot: ContextSnapshot,
  path: string,
  text: string,
): string | undefined {
  return imageReferences(text).find((reference) =>
    !imageCandidates(path, reference, snapshot.files[path] ?? "")
      .some((candidate) => candidate in snapshot.files),
  );
}

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

    const insertedText = proposed.op === "replace_text" ? proposed.newText : proposed.text;
    const missingImage = missingImageReference(snapshot, path, insertedText);
    if (missingImage) {
      return {
        ok: false,
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: `Referenced image does not exist in the project: ${missingImage}`,
          operationIndex: index,
          path,
        },
      };
    }

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
    const placement = resolveInsertPlacement({
      source: content,
      text: proposed.text,
      preferredAnchor: proposed.anchor,
      ...(proposed.targetKind ? { targetKind: proposed.targetKind } : {}),
      proposedOp: proposed.op,
    });
    if (!placement) {
      return {
        ok: false,
        error: {
          code: "ANCHOR_NOT_FOUND",
          message:
            "Could not locate a correct insert position for this structural edit",
          operationIndex: index,
          path,
        },
      };
    }
    operations.push({
      op: placement.op,
      path,
      baseSha256,
      anchor: placement.anchor,
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
        compile: options.forceCompileVerification ?? operations.some((operation) =>
          /\.(?:tex|bib)$/i.test(operation.path),
        ),
      },
    },
  };
}
