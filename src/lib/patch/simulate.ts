import { assertSafeProjectRelativePath } from "../projectPath";
import { lineContextSnippet } from "../diffPreview";
import { sha256Hex } from "./hash";
import { projectRevision } from "./revision";
import type {
  BibAddOperation,
  EditOperation,
  FileSnapshot,
  PatchPreview,
  PatchSet,
  PatchValidationError,
  StructuredBibEntry,
} from "./schema";

export type PatchSimulation = {
  nextFiles: Record<string, string>;
  snapshots: Record<string, FileSnapshot>;
  postApplyHashes: Record<string, string>;
  changes: PatchPreview[];
  affectedPaths: string[];
  baseProjectRevision: string;
  nextProjectRevision: string;
};

export type SimulatePatchResult =
  | { ok: true; simulation: PatchSimulation }
  | { ok: false; error: PatchValidationError };

function failure(
  code: PatchValidationError["code"],
  message: string,
  operationIndex?: number,
  path?: string,
): SimulatePatchResult {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(operationIndex === undefined ? {} : { operationIndex }),
      ...(path === undefined ? {} : { path }),
    },
  };
}

function occurrenceIndexes(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const indexes: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    indexes.push(index);
    from = index + 1;
  }
  return indexes;
}

function stripTexComments(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "%") continue;
        let slashes = 0;
        for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
          slashes += 1;
        }
        if (slashes % 2 === 0) return line.slice(0, index);
      }
      return line;
    })
    .join("\n")
    .trim();
}

function semanticTailAfterEndDocument(content: string): string | null {
  // TeX accepts optional whitespace between the control word and its argument.
  // Strip comments first so a commented marker cannot hide prose after the
  // first active document terminator.
  const uncommented = stripTexComments(content);
  const marker = /\\end\s*\{\s*document\s*\}/i.exec(uncommented);
  if (!marker || marker.index < 0) return null;
  return uncommented.slice(marker.index + marker[0].length).trim();
}

function bibKeyFromEntry(bibtex: string): string | null {
  const match = bibtex.match(/^\s*@\w+\s*\{\s*([^,\s]+)\s*,/i);
  return match?.[1] ?? null;
}

function normalizedIdentifier(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function existingBibKeys(content: string): Set<string> {
  return new Set(
    [...content.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/gi)].map((match) => match[1]!.toLowerCase()),
  );
}

function existingBibField(content: string, field: string): Set<string> {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*=\\s*[{"]([^}"]+)[}"]`, "gi");
  return new Set([...content.matchAll(re)].map((match) => match[1]!.trim().toLowerCase()));
}

function normalizedTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[{}\\]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function validateBibEntry(entry: StructuredBibEntry): PatchValidationError | null {
  const embedded = bibKeyFromEntry(entry.bibtex);
  if (!embedded || embedded !== entry.citeKey) {
    return {
      code: "BIB_ENTRY_MISMATCH",
      message: `BibTeX key ${embedded ?? "<missing>"} does not match citeKey ${entry.citeKey}`,
    };
  }
  if (entry.doi) {
    const doiMatch = entry.bibtex.match(/\bdoi\s*=\s*[{"]([^}"]+)[}"]/i)?.[1]?.trim();
    if (!doiMatch || normalizedIdentifier(doiMatch) !== normalizedIdentifier(entry.doi)) {
      return {
        code: "BIB_ENTRY_MISMATCH",
        message: `BibTeX DOI does not match structured DOI for ${entry.citeKey}`,
      };
    }
  }
  return null;
}

export function mergeBibEntries(
  current: string,
  entries: StructuredBibEntry[],
): { ok: true; content: string; added: StructuredBibEntry[] } | { ok: false; error: PatchValidationError } {
  const keys = existingBibKeys(current);
  const dois = existingBibField(current, "doi");
  const pmids = new Set<string>([
    ...existingBibField(current, "pmid"),
    ...[...current.matchAll(/PMID\s*:\s*(\d+)/gi)].map((match) => match[1]!.toLowerCase()),
  ]);
  const titles = new Set<string>(
    [...existingBibField(current, "title")].map((title) => normalizedTitle(title)),
  );
  const added: StructuredBibEntry[] = [];

  for (const entry of entries) {
    const structuralError = validateBibEntry(entry);
    if (structuralError) return { ok: false, error: structuralError };

    const key = entry.citeKey.toLowerCase();
    const doi = normalizedIdentifier(entry.doi);
    const pmid = normalizedIdentifier(entry.pmid);
    const title = entry.normalizedTitle ? normalizedTitle(entry.normalizedTitle) : undefined;

    if (keys.has(key) || (doi && dois.has(doi)) || (pmid && pmids.has(pmid)) || (title && titles.has(title))) {
      continue;
    }

    keys.add(key);
    if (doi) dois.add(doi);
    if (pmid) pmids.add(pmid);
    if (title) titles.add(title);
    added.push(entry);
  }

  if (added.length === 0) return { ok: true, content: current, added };
  const prefix = current.trimEnd();
  const addition = added.map((entry) => entry.bibtex.trim()).join("\n\n");
  return {
    ok: true,
    content: prefix ? `${prefix}\n\n${addition}\n` : `${addition}\n`,
    added,
  };
}

async function validateBaseHashes(
  initialFiles: Record<string, string>,
  patchSet: PatchSet,
): Promise<PatchValidationError | null> {
  for (let index = 0; index < patchSet.operations.length; index += 1) {
    const operation = patchSet.operations[index]!;
    const path = operation.path;
    const current = initialFiles[path];

    if (operation.op === "bib_add" && operation.mustNotExist) {
      if (current !== undefined) {
        return {
          code: "FILE_ALREADY_EXISTS",
          message: `Expected ${path} not to exist`,
          operationIndex: index,
          path,
        };
      }
      continue;
    }

    if (current === undefined) {
      return {
        code: "FILE_NOT_FOUND",
        message: `File not found: ${path}`,
        operationIndex: index,
        path,
      };
    }

    const expected = operation.baseSha256;
    if (!expected) {
      return {
        code: "INVALID_PATCH",
        message: `Missing baseSha256 for existing file: ${path}`,
        operationIndex: index,
        path,
      };
    }
    const actual = await sha256Hex(current);
    if (actual !== expected.toLowerCase()) {
      return {
        code: "BASE_MISMATCH",
        message: `File changed since the patch was created: ${path}`,
        operationIndex: index,
        path,
      };
    }
  }
  return null;
}

function applyTextOperation(
  content: string,
  operation: Exclude<EditOperation, BibAddOperation>,
):
  | { ok: true; content: string; preview: PatchPreview }
  | { ok: false; code: PatchValidationError["code"]; message: string } {
  if (operation.op === "replace_text") {
    if (!operation.oldText) {
      return { ok: false, code: "EMPTY_OLD_TEXT", message: "replace_text.oldText must not be empty" };
    }

    let start: number;
    if (operation.range) {
      const { start: rangeStart, end: rangeEnd } = operation.range;
      if (rangeEnd > content.length || content.slice(rangeStart, rangeEnd) !== operation.oldText) {
        return {
          ok: false,
          code: "RANGE_MISMATCH",
          message: "The runtime selection no longer matches oldText",
        };
      }
      start = rangeStart;
    } else {
      const indexes = occurrenceIndexes(content, operation.oldText);
      if (indexes.length === 0) {
        return { ok: false, code: "OLD_TEXT_NOT_FOUND", message: "oldText was not found" };
      }
      if (indexes.length !== 1) {
        return {
          ok: false,
          code: "OLD_TEXT_NOT_UNIQUE",
          message: `oldText matched ${indexes.length} locations`,
        };
      }
      start = indexes[0]!;
    }

    const beforeRange = { start, end: start + operation.oldText.length };
    const next = `${content.slice(0, start)}${operation.newText}${content.slice(beforeRange.end)}`;
    const afterRange = { start, end: start + operation.newText.length };
    return {
      ok: true,
      content: next,
      preview: {
        path: operation.path,
        op: operation.op,
        before: lineContextSnippet(content, beforeRange),
        after: lineContextSnippet(next, afterRange),
        beforeRange,
        afterRange,
      },
    };
  }

  if (!operation.anchor) {
    return { ok: false, code: "ANCHOR_NOT_FOUND", message: "anchor must not be empty" };
  }
  const indexes = occurrenceIndexes(content, operation.anchor);
  if (indexes.length === 0) {
    return { ok: false, code: "ANCHOR_NOT_FOUND", message: "anchor was not found" };
  }
  if (indexes.length !== 1) {
    return {
      ok: false,
      code: "ANCHOR_NOT_UNIQUE",
      message: `anchor matched ${indexes.length} locations`,
    };
  }

  const anchorStart = indexes[0]!;
  const insertionPoint =
    operation.op === "insert_before" ? anchorStart : anchorStart + operation.anchor.length;
  const next = `${content.slice(0, insertionPoint)}${operation.text}${content.slice(insertionPoint)}`;
  const beforeRange = { start: insertionPoint, end: insertionPoint };
  const afterRange = { start: insertionPoint, end: insertionPoint + operation.text.length };
  return {
    ok: true,
    content: next,
    preview: {
      path: operation.path,
      op: operation.op,
      before: lineContextSnippet(content, {
        start: Math.max(0, anchorStart),
        end: anchorStart + operation.anchor.length,
      }),
      after: lineContextSnippet(next, afterRange),
      beforeRange,
      afterRange,
    },
  };
}

export async function simulatePatchSet(
  files: Record<string, string>,
  patchSet: PatchSet,
): Promise<SimulatePatchResult> {
  const initialFiles = { ...files };
  const currentRevision = await projectRevision(initialFiles);
  if (currentRevision !== patchSet.projectRevision) {
    return failure(
      "PROJECT_REVISION_MISMATCH",
      "Project changed since the patch was created",
    );
  }

  for (let index = 0; index < patchSet.operations.length; index += 1) {
    const operation = patchSet.operations[index]!;
    try {
      const normalized = assertSafeProjectRelativePath(operation.path);
      if (normalized !== operation.path) {
        return failure("UNSAFE_PATH", `Path is not canonical: ${operation.path}`, index, operation.path);
      }
    } catch (error) {
      return failure(
        "UNSAFE_PATH",
        error instanceof Error ? error.message : String(error),
        index,
        operation.path,
      );
    }
  }

  const baseError = await validateBaseHashes(initialFiles, patchSet);
  if (baseError) return { ok: false, error: baseError };

  const nextFiles = { ...initialFiles };
  const snapshots: Record<string, FileSnapshot> = {};
  const changes: PatchPreview[] = [];
  const affectedPaths: string[] = [];

  for (let index = 0; index < patchSet.operations.length; index += 1) {
    const operation = patchSet.operations[index]!;
    const path = operation.path;
    if (!(path in snapshots)) {
      snapshots[path] =
        initialFiles[path] === undefined
          ? { existed: false }
          : { existed: true, content: initialFiles[path] };
      affectedPaths.push(path);
    }

    if (operation.op === "bib_add") {
      const before = nextFiles[path] ?? "";
      const merged = mergeBibEntries(before, operation.entries);
      if (!merged.ok) {
        return {
          ok: false,
          error: { ...merged.error, operationIndex: index, path },
        };
      }
      nextFiles[path] = merged.content;
      const beforeRange = { start: before.length, end: before.length };
      const afterRange = { start: before.length, end: merged.content.length };
      changes.push({
        path,
        op: operation.op,
        before: lineContextSnippet(before, beforeRange),
        after: lineContextSnippet(merged.content, afterRange),
        beforeRange,
        afterRange,
      });
      continue;
    }

    const before = nextFiles[path];
    if (before === undefined) {
      return failure("FILE_NOT_FOUND", `File not found: ${path}`, index, path);
    }
    const applied = applyTextOperation(before, operation);
    if (!applied.ok) return failure(applied.code, applied.message, index, path);
    nextFiles[path] = applied.content;
    changes.push(applied.preview);
  }

  for (const path of affectedPaths) {
    if (!path.toLowerCase().endsWith(".tex")) continue;
    const before = initialFiles[path];
    const after = nextFiles[path];
    if (before === undefined || after === undefined) continue;
    const beforeTail = semanticTailAfterEndDocument(before);
    const afterTail = semanticTailAfterEndDocument(after);
    if (beforeTail !== null && afterTail === null) {
      return failure(
        "TEX_TRAILING_CONTENT",
        `Patch removed \\end{document} from ${path}`,
        undefined,
        path,
      );
    }
    if (beforeTail !== null && afterTail !== beforeTail) {
      return failure(
        "TEX_TRAILING_CONTENT",
        `Patch changed non-comment content after \\end{document} in ${path}`,
        undefined,
        path,
      );
    }
    if (beforeTail === null && afterTail !== null && afterTail.length > 0) {
      return failure(
        "TEX_TRAILING_CONTENT",
        `Patch introduced non-comment content after \\end{document} in ${path}`,
        undefined,
        path,
      );
    }
  }

  const postApplyHashes: Record<string, string> = {};
  for (const path of affectedPaths) {
    const content = nextFiles[path];
    if (content !== undefined) postApplyHashes[path] = await sha256Hex(content);
  }

  return {
    ok: true,
    simulation: {
      nextFiles,
      snapshots,
      postApplyHashes,
      changes,
      affectedPaths,
      baseProjectRevision: currentRevision,
      nextProjectRevision: await projectRevision(nextFiles),
    },
  };
}
