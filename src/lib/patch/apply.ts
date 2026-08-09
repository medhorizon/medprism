import { sha256Hex } from "./hash";
import {
  countOccurrences,
  type EditOperation,
  type PatchPreview,
  type PatchSet,
  type PatchValidationError,
} from "./schema";
import { mergeBibEntries, validatePatchSet } from "./validate";

export type ApplyOk = {
  ok: true;
  files: Record<string, string>;
  /** Snapshots of affected paths before apply */
  previousFiles: Record<string, string>;
  affectedPaths: string[];
  previews: PatchPreview[];
};

export type ApplyFail = { ok: false; error: PatchValidationError };
export type ApplyResult = ApplyOk | ApplyFail;

function applyOneMutable(
  working: Record<string, string>,
  op: EditOperation,
  opIndex: number,
): ApplyFail | null {
  if (op.op === "bib_add") {
    const prev = working[op.path] ?? "";
    working[op.path] = mergeBibEntries(prev, op.entries);
    return null;
  }

  const content = working[op.path];
  if (content === undefined) {
    return {
      ok: false,
      error: {
        code: "FILE_NOT_FOUND",
        message: `File not found: ${op.path}`,
        path: op.path,
        opIndex,
      },
    };
  }

  if (op.op === "replace_text") {
    const n = countOccurrences(content, op.oldText);
    if (n === 0) {
      return {
        ok: false,
        error: {
          code: "OLD_TEXT_NOT_FOUND",
          message: "oldText not found during apply",
          path: op.path,
          opIndex,
        },
      };
    }
    if (n !== 1) {
      return {
        ok: false,
        error: {
          code: "OLD_TEXT_NOT_UNIQUE",
          message: "oldText not unique during apply",
          path: op.path,
          opIndex,
        },
      };
    }
    working[op.path] = content.replace(op.oldText, op.newText);
    return null;
  }

  const n = countOccurrences(content, op.anchor);
  if (n === 0) {
    return {
      ok: false,
      error: {
        code: "ANCHOR_NOT_FOUND",
        message: "anchor not found during apply",
        path: op.path,
        opIndex,
      },
    };
  }
  if (n !== 1) {
    return {
      ok: false,
      error: {
        code: "ANCHOR_NOT_UNIQUE",
        message: "anchor not unique during apply",
        path: op.path,
        opIndex,
      },
    };
  }
  const idx = content.indexOf(op.anchor);
  if (op.op === "insert_before") {
    working[op.path] = content.slice(0, idx) + op.text + content.slice(idx);
  } else {
    const at = idx + op.anchor.length;
    working[op.path] = content.slice(0, at) + op.text + content.slice(at);
  }
  return null;
}

/** Build before/after snippets for UI (does not mutate files). */
export function previewPatchSet(
  patchSet: PatchSet,
  files: Record<string, string>,
): PatchPreview[] {
  const working: Record<string, string> = { ...files };
  const previews: PatchPreview[] = [];

  for (let i = 0; i < patchSet.operations.length; i++) {
    const op = patchSet.operations[i]!;
    const before = working[op.path] ?? "";
    const err = applyOneMutable(working, op, i);
    if (err) break;
    const after = working[op.path] ?? "";
    previews.push({
      path: op.path,
      op: op.op,
      before: snippetForOp(op, before),
      after: snippetForOp(op, after, true),
    });
  }
  return previews;
}

function snippetForOp(
  op: EditOperation,
  content: string,
  isAfter = false,
): string {
  if (op.op === "bib_add") {
    if (!isAfter) return content.trimEnd().slice(-400);
    return content.trimEnd().slice(-800);
  }
  if (op.op === "replace_text") {
    const needle = isAfter ? op.newText : op.oldText;
    const idx = content.indexOf(needle);
    if (idx === -1) return content.slice(0, 500);
    const start = Math.max(0, idx - 80);
    const end = Math.min(content.length, idx + needle.length + 80);
    return (
      (start > 0 ? "…" : "") +
      content.slice(start, end) +
      (end < content.length ? "…" : "")
    );
  }
  const idx = content.indexOf(op.anchor);
  if (idx === -1) return content.slice(0, 500);
  const focusStart = op.op === "insert_before" && isAfter ? idx : idx;
  const start = Math.max(0, focusStart - 80);
  const end = Math.min(
    content.length,
    idx + op.anchor.length + (isAfter ? op.text.length : 0) + 80,
  );
  return (
    (start > 0 ? "…" : "") +
    content.slice(start, end) +
    (end < content.length ? "…" : "")
  );
}

/**
 * Validate then apply all operations atomically.
 * Never EOF-appends to `.tex`. On any failure, returns error and leaves files unchanged.
 */
export async function applyPatchSet(
  patchSet: PatchSet,
  files: Record<string, string>,
): Promise<ApplyResult> {
  const validated = await validatePatchSet(patchSet, files);
  if (!validated.ok) return validated;

  const previousFiles: Record<string, string> = {};
  const affected = new Set<string>();
  for (const op of patchSet.operations) {
    affected.add(op.path);
    if (!(op.path in previousFiles)) {
      previousFiles[op.path] = files[op.path] ?? "";
    }
  }

  const working: Record<string, string> = { ...files };
  const previews = previewPatchSet(patchSet, files);

  for (let i = 0; i < patchSet.operations.length; i++) {
    const err = applyOneMutable(working, patchSet.operations[i]!, i);
    if (err) {
      // Should not happen after validate; fail closed without mutating caller files
      return err;
    }
  }

  return {
    ok: true,
    files: working,
    previousFiles,
    affectedPaths: [...affected],
    previews,
  };
}

/**
 * Undo a previously applied patch.
 * Refuses if any affected file no longer matches the post-apply content hash.
 */
export async function undoPatchSet(args: {
  files: Record<string, string>;
  previousFiles: Record<string, string>;
  /** SHA-256 of each affected file immediately after Keep */
  postApplyHashes: Record<string, string>;
}): Promise<
  | { ok: true; files: Record<string, string> }
  | { ok: false; error: PatchValidationError }
> {
  for (const [path, expectedHash] of Object.entries(args.postApplyHashes)) {
    const current = args.files[path];
    if (current === undefined) {
      return {
        ok: false,
        error: {
          code: "FILE_NOT_FOUND",
          message: `Cannot undo: missing ${path}`,
          path,
        },
      };
    }
    const hash = await sha256Hex(current);
    if (hash !== expectedHash) {
      return {
        ok: false,
        error: {
          code: "BASE_MISMATCH",
          message: `Cannot undo: ${path} was edited after Keep`,
          path,
        },
      };
    }
  }

  const next = { ...args.files };
  for (const [path, prev] of Object.entries(args.previousFiles)) {
    next[path] = prev;
  }
  return { ok: true, files: next };
}
