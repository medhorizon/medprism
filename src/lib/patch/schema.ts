export type StructuredBibEntry = {
  citeKey: string;
  bibtex: string;
  doi?: string;
};

export type ReplaceTextOperation = {
  op: "replace_text";
  path: string;
  baseSha256: string;
  oldText: string;
  newText: string;
  expectedOccurrences: 1;
};

export type InsertOperation = {
  op: "insert_before" | "insert_after";
  path: string;
  baseSha256: string;
  anchor: string;
  text: string;
  expectedOccurrences: 1;
};

export type BibAddOperation = {
  op: "bib_add";
  path: string;
  /** Optional; when omitted, validate against empty/new file semantics via entries only */
  baseSha256?: string;
  entries: StructuredBibEntry[];
};

export type EditOperation =
  | ReplaceTextOperation
  | InsertOperation
  | BibAddOperation;

export type PatchSet = {
  schemaVersion: "1";
  id: string;
  summary: string;
  operations: EditOperation[];
  verify?: {
    compile?: boolean;
  };
};

export type PatchValidationErrorCode =
  | "FILE_NOT_FOUND"
  | "BASE_MISMATCH"
  | "OLD_TEXT_NOT_FOUND"
  | "OLD_TEXT_NOT_UNIQUE"
  | "ANCHOR_NOT_FOUND"
  | "ANCHOR_NOT_UNIQUE"
  | "INVALID_OPERATION"
  | "CONFLICTING_OPERATIONS"
  | "INVALID_PATCH"
  | "DUPLICATE_CITE_KEY"
  | "EMPTY_OLD_TEXT"
  | "PATH_MISMATCH";

export type PatchValidationError = {
  code: PatchValidationErrorCode;
  message: string;
  path?: string;
  opIndex?: number;
};

export type PatchPreview = {
  path: string;
  op: EditOperation["op"];
  before: string;
  after: string;
};

const ALLOWED_OPS = new Set([
  "replace_text",
  "insert_before",
  "insert_after",
  "bib_add",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Runtime structural validator — does not check file contents. */
export function parsePatchSet(raw: unknown):
  | { ok: true; patchSet: PatchSet }
  | { ok: false; error: PatchValidationError } {
  if (!isRecord(raw)) {
    return {
      ok: false,
      error: { code: "INVALID_PATCH", message: "PatchSet must be an object" },
    };
  }
  if (raw.schemaVersion !== "1") {
    return {
      ok: false,
      error: {
        code: "INVALID_PATCH",
        message: 'schemaVersion must be "1"',
      },
    };
  }
  const id = asString(raw.id);
  const summary = asString(raw.summary);
  if (!id || !summary) {
    return {
      ok: false,
      error: {
        code: "INVALID_PATCH",
        message: "id and summary are required",
      },
    };
  }
  if (!Array.isArray(raw.operations) || raw.operations.length === 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_PATCH",
        message: "operations must be a non-empty array",
      },
    };
  }

  const operations: EditOperation[] = [];
  for (let i = 0; i < raw.operations.length; i++) {
    const opRaw = raw.operations[i];
    if (!isRecord(opRaw)) {
      return {
        ok: false,
        error: {
          code: "INVALID_OPERATION",
          message: `operations[${i}] must be an object`,
          opIndex: i,
        },
      };
    }
    const op = asString(opRaw.op);
    if (!op || !ALLOWED_OPS.has(op)) {
      return {
        ok: false,
        error: {
          code: "INVALID_OPERATION",
          message: `Unknown or missing op at operations[${i}]`,
          opIndex: i,
        },
      };
    }
    const path = asString(opRaw.path)?.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!path) {
      return {
        ok: false,
        error: {
          code: "INVALID_OPERATION",
          message: `operations[${i}].path is required`,
          opIndex: i,
        },
      };
    }

    if (op === "replace_text") {
      const baseSha256 = asString(opRaw.baseSha256);
      const oldText = asString(opRaw.oldText);
      const newText = asString(opRaw.newText);
      if (!baseSha256 || oldText === undefined || newText === undefined) {
        return {
          ok: false,
          error: {
            code: "INVALID_OPERATION",
            message: `replace_text requires baseSha256, oldText, newText`,
            opIndex: i,
            path,
          },
        };
      }
      if (oldText.length === 0) {
        return {
          ok: false,
          error: {
            code: "EMPTY_OLD_TEXT",
            message: "replace_text.oldText must be non-empty",
            opIndex: i,
            path,
          },
        };
      }
      operations.push({
        op: "replace_text",
        path,
        baseSha256,
        oldText,
        newText,
        expectedOccurrences: 1,
      });
      continue;
    }

    if (op === "insert_before" || op === "insert_after") {
      const baseSha256 = asString(opRaw.baseSha256);
      const anchor = asString(opRaw.anchor);
      const text = asString(opRaw.text);
      if (!baseSha256 || !anchor || text === undefined) {
        return {
          ok: false,
          error: {
            code: "INVALID_OPERATION",
            message: `${op} requires baseSha256, anchor, text`,
            opIndex: i,
            path,
          },
        };
      }
      if (anchor.length === 0) {
        return {
          ok: false,
          error: {
            code: "INVALID_OPERATION",
            message: "anchor must be non-empty",
            opIndex: i,
            path,
          },
        };
      }
      operations.push({
        op,
        path,
        baseSha256,
        anchor,
        text,
        expectedOccurrences: 1,
      });
      continue;
    }

    // bib_add
    if (!path.endsWith(".bib")) {
      return {
        ok: false,
        error: {
          code: "INVALID_OPERATION",
          message: "bib_add path must end with .bib",
          opIndex: i,
          path,
        },
      };
    }
    if (!Array.isArray(opRaw.entries) || opRaw.entries.length === 0) {
      return {
        ok: false,
        error: {
          code: "INVALID_OPERATION",
          message: "bib_add.entries must be a non-empty array",
          opIndex: i,
          path,
        },
      };
    }
    const entries: StructuredBibEntry[] = [];
    for (const e of opRaw.entries) {
      if (!isRecord(e)) {
        return {
          ok: false,
          error: {
            code: "INVALID_OPERATION",
            message: "bib entry must be an object",
            opIndex: i,
            path,
          },
        };
      }
      const citeKey = asString(e.citeKey);
      const bibtex = asString(e.bibtex);
      if (!citeKey || !bibtex) {
        return {
          ok: false,
          error: {
            code: "INVALID_OPERATION",
            message: "bib entry requires citeKey and bibtex",
            opIndex: i,
            path,
          },
        };
      }
      entries.push({
        citeKey,
        bibtex,
        doi: asString(e.doi),
      });
    }
    operations.push({
      op: "bib_add",
      path,
      baseSha256: asString(opRaw.baseSha256),
      entries,
    });
  }

  return {
    ok: true,
    patchSet: {
      schemaVersion: "1",
      id,
      summary,
      operations,
      verify: isRecord(raw.verify)
        ? { compile: Boolean(raw.verify.compile) }
        : undefined,
    },
  };
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}
