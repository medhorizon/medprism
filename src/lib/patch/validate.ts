import { sha256Hex } from "./hash";
import {
  countOccurrences,
  type EditOperation,
  type PatchSet,
  type PatchValidationError,
} from "./schema";

export type ValidateOk = { ok: true };
export type ValidateFail = { ok: false; error: PatchValidationError };
export type ValidateResult = ValidateOk | ValidateFail;

function fail(
  code: PatchValidationError["code"],
  message: string,
  extra?: Partial<PatchValidationError>,
): ValidateFail {
  return { ok: false, error: { code, message, ...extra } };
}

/** Detect ops that cannot both succeed on the same original file content. */
function findConflictingOps(operations: EditOperation[]): PatchValidationError | null {
  for (let i = 0; i < operations.length; i++) {
    for (let j = i + 1; j < operations.length; j++) {
      const a = operations[i]!;
      const b = operations[j]!;
      if (a.path !== b.path) continue;

      if (a.op === "replace_text" && b.op === "replace_text") {
        if (a.oldText === b.oldText) {
          return {
            code: "CONFLICTING_OPERATIONS",
            message: `Conflicting replace_text on same oldText in ${a.path}`,
            path: a.path,
            opIndex: j,
          };
        }
        // Overlapping spans in original content
        if (
          a.oldText.includes(b.oldText) ||
          b.oldText.includes(a.oldText)
        ) {
          return {
            code: "CONFLICTING_OPERATIONS",
            message: `Overlapping replace_text in ${a.path}`,
            path: a.path,
            opIndex: j,
          };
        }
      }

      if (
        (a.op === "insert_before" || a.op === "insert_after") &&
        (b.op === "insert_before" || b.op === "insert_after") &&
        a.anchor === b.anchor &&
        a.op === b.op
      ) {
        return {
          code: "CONFLICTING_OPERATIONS",
          message: `Duplicate ${a.op} on same anchor in ${a.path}`,
          path: a.path,
          opIndex: j,
        };
      }
    }
  }
  return null;
}

/**
 * Validate PatchSet against current project files.
 * Paths must exist exactly (no basename guessing), except bib_add may create missing .bib.
 */
export async function validatePatchSet(
  patchSet: PatchSet,
  files: Record<string, string>,
): Promise<ValidateResult> {
  const conflict = findConflictingOps(patchSet.operations);
  if (conflict) return { ok: false, error: conflict };

  for (let i = 0; i < patchSet.operations.length; i++) {
    const op = patchSet.operations[i]!;
    const path = op.path;

    if (op.op === "bib_add") {
      const content = files[path] ?? "";
      if (op.baseSha256 !== undefined && path in files) {
        const hash = await sha256Hex(content);
        if (hash !== op.baseSha256) {
          return fail(
            "BASE_MISMATCH",
            `File ${path} changed since patch was generated`,
            { path, opIndex: i },
          );
        }
      }
      const existingKeys = new Set(
        [...content.matchAll(/@\w+\s*\{\s*([^,\s]+)/g)].map((m) => m[1]!),
      );
      const existingDois = new Set(
        [...content.matchAll(/doi\s*=\s*[{"]([^}"]+)[}"]/gi)].map((m) =>
          m[1]!.toLowerCase(),
        ),
      );
      const seenKeys = new Set<string>();
      for (const e of op.entries) {
        if (seenKeys.has(e.citeKey) || existingKeys.has(e.citeKey)) {
          // Duplicate is soft-skip at apply; structural OK. Hard-fail only if empty bibtex.
          continue;
        }
        if (e.doi && existingDois.has(e.doi.toLowerCase())) continue;
        seenKeys.add(e.citeKey);
      }
      continue;
    }

    if (!(path in files)) {
      return fail("FILE_NOT_FOUND", `File not found: ${path}`, {
        path,
        opIndex: i,
      });
    }

    const content = files[path]!;
    const hash = await sha256Hex(content);
    if (hash !== op.baseSha256) {
      return fail(
        "BASE_MISMATCH",
        `File ${path} changed since patch was generated (stale patch)`,
        { path, opIndex: i },
      );
    }

    if (op.op === "replace_text") {
      if (!op.oldText) {
        return fail("EMPTY_OLD_TEXT", "oldText must be non-empty", {
          path,
          opIndex: i,
        });
      }
      const n = countOccurrences(content, op.oldText);
      if (n === 0) {
        return fail("OLD_TEXT_NOT_FOUND", "oldText not found in file", {
          path,
          opIndex: i,
        });
      }
      if (n !== 1) {
        return fail(
          "OLD_TEXT_NOT_UNIQUE",
          `oldText occurs ${n} times; expected 1`,
          { path, opIndex: i },
        );
      }
    } else {
      const n = countOccurrences(content, op.anchor);
      if (n === 0) {
        return fail("ANCHOR_NOT_FOUND", "anchor not found in file", {
          path,
          opIndex: i,
        });
      }
      if (n !== 1) {
        return fail(
          "ANCHOR_NOT_UNIQUE",
          `anchor occurs ${n} times; expected 1`,
          { path, opIndex: i },
        );
      }
    }
  }

  // Dry-run sequential apply on copies to ensure all ops succeed together
  const working: Record<string, string> = { ...files };
  for (let i = 0; i < patchSet.operations.length; i++) {
    const op = patchSet.operations[i]!;
    const step = dryRunOne(working, op, i);
    if (!step.ok) return step;
  }

  return { ok: true };
}

function dryRunOne(
  working: Record<string, string>,
  op: EditOperation,
  opIndex: number,
): ValidateResult {
  if (op.op === "bib_add") {
    const prev = working[op.path] ?? "";
    working[op.path] = mergeBibEntries(prev, op.entries);
    return { ok: true };
  }

  const content = working[op.path];
  if (content === undefined) {
    return fail("FILE_NOT_FOUND", `File not found: ${op.path}`, {
      path: op.path,
      opIndex,
    });
  }

  if (op.op === "replace_text") {
    const n = countOccurrences(content, op.oldText);
    if (n === 0) {
      return fail("OLD_TEXT_NOT_FOUND", "oldText not found during apply", {
        path: op.path,
        opIndex,
      });
    }
    if (n !== 1) {
      return fail("OLD_TEXT_NOT_UNIQUE", "oldText not unique during apply", {
        path: op.path,
        opIndex,
      });
    }
    working[op.path] = content.replace(op.oldText, op.newText);
    return { ok: true };
  }

  const n = countOccurrences(content, op.anchor);
  if (n === 0) {
    return fail("ANCHOR_NOT_FOUND", "anchor not found during apply", {
      path: op.path,
      opIndex,
    });
  }
  if (n !== 1) {
    return fail("ANCHOR_NOT_UNIQUE", "anchor not unique during apply", {
      path: op.path,
      opIndex,
    });
  }
  const idx = content.indexOf(op.anchor);
  if (op.op === "insert_before") {
    working[op.path] =
      content.slice(0, idx) + op.text + content.slice(idx);
  } else {
    const at = idx + op.anchor.length;
    working[op.path] = content.slice(0, at) + op.text + content.slice(at);
  }
  return { ok: true };
}

export function mergeBibEntries(
  previous: string,
  entries: { citeKey: string; bibtex: string; doi?: string }[],
): string {
  const existingKeys = new Set(
    [...previous.matchAll(/@\w+\s*\{\s*([^,\s]+)/g)].map((m) => m[1]!),
  );
  const existingDois = new Set(
    [...previous.matchAll(/doi\s*=\s*[{"]([^}"]+)[}"]/gi)].map((m) =>
      m[1]!.toLowerCase(),
    ),
  );

  const toAdd: string[] = [];
  for (const e of entries) {
    if (existingKeys.has(e.citeKey)) continue;
    if (e.doi && existingDois.has(e.doi.toLowerCase())) continue;
    const block = e.bibtex.trim();
    if (!block) continue;
    if (previous.includes(block)) continue;
    toAdd.push(block);
    existingKeys.add(e.citeKey);
    if (e.doi) existingDois.add(e.doi.toLowerCase());
  }
  if (!toAdd.length) return previous;
  const base = previous.trimEnd();
  return base ? `${base}\n\n${toAdd.join("\n\n")}\n` : `${toAdd.join("\n\n")}\n`;
}
