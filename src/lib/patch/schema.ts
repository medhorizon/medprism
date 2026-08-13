import { parseTargetKind } from "../latex/targetKind";
import type { LatexTargetKind } from "../latex/types";
import { assertSafeProjectRelativePath, UnsafeProjectPathError } from "../projectPath";
import { isSha256Hex } from "./hash";

export const PATCH_SCHEMA_VERSION = "1" as const;
export const MAX_PATCH_OPERATIONS = 32;
export const MAX_PATCH_TEXT_LENGTH = 250_000;

export type SourceRange = { start: number; end: number };

export type StructuredBibEntry = {
  citeKey: string;
  bibtex: string;
  doi?: string;
  pmid?: string;
  normalizedTitle?: string;
};

export type ReplaceTextOperation = {
  op: "replace_text";
  path: string;
  baseSha256: string;
  oldText: string;
  newText: string;
  expectedOccurrences: 1;
  /** Runtime-attached exact editor selection. The model never supplies this field. */
  range?: SourceRange;
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
  entries: StructuredBibEntry[];
  /** Required when the .bib file already exists. */
  baseSha256?: string;
  /** Runtime sets true when creating a new bibliography file. */
  mustNotExist?: true;
};

export type EditOperation = ReplaceTextOperation | InsertOperation | BibAddOperation;

export type PatchSet = {
  schemaVersion: typeof PATCH_SCHEMA_VERSION;
  id: string;
  projectRevision: string;
  summary: string;
  operations: EditOperation[];
  verify?: { compile?: boolean };
};

/** Language-model output before deterministic metadata is attached by the runtime. */
export type ModelEditProposal =
  | {
      op: "replace_text";
      path?: string;
      oldText: string;
      newText: string;
    }
  | {
      op: "insert_before" | "insert_after";
      path?: string;
      /** Optional; runtime may replace with a trusted unique source marker. */
      anchor: string;
      text: string;
      /** Semantic destination; runtime resolves the real insert position. */
      targetKind?: LatexTargetKind;
    };

export type ModelPatchProposal = {
  schemaVersion: typeof PATCH_SCHEMA_VERSION;
  summary: string;
  operations: ModelEditProposal[];
};

export type FileSnapshot =
  | { existed: true; content: string }
  | { existed: false };

export type PatchPreview = {
  path: string;
  op: EditOperation["op"];
  before: string;
  after: string;
  beforeRange: SourceRange;
  afterRange: SourceRange;
};

export type PatchValidationErrorCode =
  | "INVALID_PATCH"
  | "INVALID_OPERATION"
  | "LIMIT_EXCEEDED"
  | "UNSAFE_PATH"
  | "FILE_NOT_FOUND"
  | "FILE_ALREADY_EXISTS"
  | "PROJECT_REVISION_MISMATCH"
  | "BASE_MISMATCH"
  | "EMPTY_OLD_TEXT"
  | "OLD_TEXT_NOT_FOUND"
  | "OLD_TEXT_NOT_UNIQUE"
  | "ANCHOR_NOT_FOUND"
  | "ANCHOR_NOT_UNIQUE"
  | "RANGE_MISMATCH"
  | "CONFLICTING_OPERATIONS"
  | "DUPLICATE_CITE_KEY"
  | "BIB_ENTRY_MISMATCH"
  | "BIBLIOGRAPHY_NOT_CONFIGURED"
  | "RESOURCE_NOT_FOUND"
  | "TEX_TRAILING_CONTENT";

export type PatchValidationError = {
  code: PatchValidationErrorCode;
  message: string;
  operationIndex?: number;
  path?: string;
};

export type ParsePatchResult =
  | { ok: true; patchSet: PatchSet }
  | { ok: false; error: PatchValidationError };

export type ParseProposalResult =
  | { ok: true; proposal: ModelPatchProposal }
  | { ok: false; error: PatchValidationError };

function invalid(message: string): ParsePatchResult {
  return { ok: false, error: { code: "INVALID_PATCH", message } };
}

function invalidProposal(message: string): ParseProposalResult {
  return { ok: false, error: { code: "INVALID_PATCH", message } };
}

function strictCompileFlag(value: unknown): { ok: true; value?: boolean } | { ok: false } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "boolean") return { ok: false };
  return { ok: true, value };
}

function compileFlagFromContainer(value: unknown): { ok: true; value?: boolean } | { ok: false } {
  if (value === undefined) return { ok: true };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
  return strictCompileFlag((value as Record<string, unknown>).compile);
}

function checkedPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return assertSafeProjectRelativePath(value);
  } catch {
    return null;
  }
}

function checkedText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (value.length > MAX_PATCH_TEXT_LENGTH) {
    throw new Error(`${field} exceeds ${MAX_PATCH_TEXT_LENGTH} characters`);
  }
  return value;
}

function parseExpectedOccurrences(raw: Record<string, unknown>): 1 {
  if (raw.expectedOccurrences === undefined) return 1;
  if (raw.expectedOccurrences !== 1) {
    throw new Error("expectedOccurrences must equal 1");
  }
  return 1;
}

function parseStructuredBibEntries(value: unknown): StructuredBibEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("bib_add.entries must be a non-empty array");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`bib_add.entries[${index}] must be an object`);
    }
    const raw = item as Record<string, unknown>;
    const citeKey = checkedText(raw.citeKey, `entries[${index}].citeKey`).trim();
    const bibtex = checkedText(raw.bibtex, `entries[${index}].bibtex`).trim();
    if (!/^[A-Za-z0-9_:+.-]+$/.test(citeKey)) {
      throw new Error(`Invalid citeKey: ${citeKey}`);
    }
    if (!bibtex) throw new Error("BibTeX must not be empty");
    const doi = typeof raw.doi === "string" ? raw.doi.trim() : "";
    const pmid = typeof raw.pmid === "string" ? raw.pmid.trim() : "";
    const title = typeof raw.normalizedTitle === "string" ? raw.normalizedTitle.trim() : "";
    return {
      citeKey,
      bibtex,
      ...(doi ? { doi } : {}),
      ...(pmid ? { pmid } : {}),
      ...(title ? { normalizedTitle: title } : {}),
    };
  });
}

export function parsePatchSet(value: unknown): ParsePatchResult {
  if (!value || typeof value !== "object") return invalid("PatchSet must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== PATCH_SCHEMA_VERSION) return invalid("Unsupported schemaVersion");
  if (typeof raw.id !== "string" || !raw.id.trim()) return invalid("PatchSet.id is required");
  if (!isSha256Hex(raw.projectRevision)) return invalid("PatchSet.projectRevision must be SHA-256");
  if (typeof raw.summary !== "string") return invalid("PatchSet.summary must be a string");
  if (!Array.isArray(raw.operations) || raw.operations.length === 0) {
    return invalid("PatchSet.operations must be a non-empty array");
  }
  if (raw.operations.length > MAX_PATCH_OPERATIONS) {
    return invalid(`PatchSet exceeds ${MAX_PATCH_OPERATIONS} operations`);
  }

  const compile = compileFlagFromContainer(raw.verify);
  if (!compile.ok) return invalid("verify.compile must be boolean");

  try {
    const operations: EditOperation[] = raw.operations.map((item, operationIndex) => {
      if (!item || typeof item !== "object") {
        throw new Error(`operations[${operationIndex}] must be an object`);
      }
      const op = item as Record<string, unknown>;
      const path = checkedPath(op.path);
      if (!path) throw new UnsafeProjectPathError(String(op.path), "invalid project path");

      if (op.op === "replace_text") {
        if (!isSha256Hex(op.baseSha256)) throw new Error("replace_text.baseSha256 is invalid");
        const rangeRaw = op.range;
        let range: SourceRange | undefined;
        if (rangeRaw !== undefined) {
          if (!rangeRaw || typeof rangeRaw !== "object") throw new Error("range must be an object");
          const start = (rangeRaw as Record<string, unknown>).start;
          const end = (rangeRaw as Record<string, unknown>).end;
          if (!Number.isInteger(start) || !Number.isInteger(end) || Number(start) < 0 || Number(end) < Number(start)) {
            throw new Error("range must contain valid integer start/end");
          }
          range = { start: Number(start), end: Number(end) };
        }
        return {
          op: "replace_text",
          path,
          baseSha256: String(op.baseSha256).toLowerCase(),
          oldText: checkedText(op.oldText, "replace_text.oldText"),
          newText: checkedText(op.newText, "replace_text.newText"),
          expectedOccurrences: parseExpectedOccurrences(op),
          ...(range ? { range } : {}),
        };
      }

      if (op.op === "insert_before" || op.op === "insert_after") {
        if (!isSha256Hex(op.baseSha256)) throw new Error(`${op.op}.baseSha256 is invalid`);
        return {
          op: op.op,
          path,
          baseSha256: String(op.baseSha256).toLowerCase(),
          anchor: checkedText(op.anchor, `${op.op}.anchor`),
          text: checkedText(op.text, `${op.op}.text`),
          expectedOccurrences: parseExpectedOccurrences(op),
        };
      }

      if (op.op === "bib_add") {
        const baseSha256 = op.baseSha256;
        const mustNotExist = op.mustNotExist;
        if (baseSha256 !== undefined && !isSha256Hex(baseSha256)) {
          throw new Error("bib_add.baseSha256 is invalid");
        }
        if (mustNotExist !== undefined && mustNotExist !== true) {
          throw new Error("bib_add.mustNotExist must be true when present");
        }
        if (!baseSha256 && mustNotExist !== true) {
          throw new Error("bib_add requires baseSha256 or mustNotExist:true");
        }
        return {
          op: "bib_add",
          path,
          entries: parseStructuredBibEntries(op.entries),
          ...(baseSha256 ? { baseSha256: String(baseSha256).toLowerCase() } : {}),
          ...(mustNotExist === true ? { mustNotExist: true as const } : {}),
        };
      }

      throw new Error(`Unsupported operation: ${String(op.op)}`);
    });

    return {
      ok: true,
      patchSet: {
        schemaVersion: PATCH_SCHEMA_VERSION,
        id: raw.id.trim(),
        projectRevision: String(raw.projectRevision).toLowerCase(),
        summary: raw.summary,
        operations,
        ...(compile.value === undefined ? {} : { verify: { compile: compile.value } }),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code: PatchValidationErrorCode =
      error instanceof UnsafeProjectPathError ? "UNSAFE_PATH" : "INVALID_PATCH";
    return { ok: false, error: { code, message } };
  }
}

export function parseModelPatchProposal(value: unknown): ParseProposalResult {
  if (!value || typeof value !== "object") return invalidProposal("Patch proposal must be an object");
  const raw = value as Record<string, unknown>;
  const schemaVersion =
    raw.schemaVersion === 1 || raw.schemaVersion === PATCH_SCHEMA_VERSION
      ? PATCH_SCHEMA_VERSION
      : raw.schemaVersion;
  if (schemaVersion !== PATCH_SCHEMA_VERSION) {
    return invalidProposal(
      `patchProposal.schemaVersion must be "1" or 1; received ${String(raw.schemaVersion ?? "<missing>")}`,
    );
  }
  if (typeof raw.summary !== "string") return invalidProposal("summary must be a string");
  if (!Array.isArray(raw.operations) || raw.operations.length === 0) {
    return invalidProposal("operations must be a non-empty array");
  }
  if (raw.operations.length > MAX_PATCH_OPERATIONS) {
    return invalidProposal(`Proposal exceeds ${MAX_PATCH_OPERATIONS} operations`);
  }
  const forbiddenProposalField = ["id", "projectRevision", "verify", "patch", "patchSet"].find(
    (field) => raw[field] !== undefined,
  );
  if (forbiddenProposalField) {
    return invalidProposal(
      `Model patch proposals must not contain runtime-owned field ${forbiddenProposalField}`,
    );
  }

  try {
    const operations: ModelEditProposal[] = raw.operations.map((item, index) => {
      if (!item || typeof item !== "object") throw new Error(`operations[${index}] must be an object`);
      const op = item as Record<string, unknown>;
      const forbiddenOperationField = [
        "baseSha256",
        "range",
        "expectedOccurrences",
        "entries",
        "mustNotExist",
        "citeKey",
        "bibtex",
        "doi",
        "pmid",
      ].find((field) => op[field] !== undefined);
      if (forbiddenOperationField) {
        throw new Error(
          `Model edit operation must not contain runtime-owned field ${forbiddenOperationField}`,
        );
      }
      const optionalPath = op.path === undefined ? undefined : checkedPath(op.path);
      if (op.path !== undefined && !optionalPath) {
        throw new UnsafeProjectPathError(String(op.path), "invalid project path");
      }
      if (op.op === "replace_text") {
        return {
          op: "replace_text",
          ...(optionalPath ? { path: optionalPath } : {}),
          oldText: checkedText(op.oldText, "replace_text.oldText"),
          newText: checkedText(op.newText, "replace_text.newText"),
        };
      }
      if (op.op === "insert_before" || op.op === "insert_after") {
        // Anchor may be omitted: runtime hydrate resolves a structural position.
        const anchor =
          op.anchor === undefined || op.anchor === null
            ? ""
            : checkedText(op.anchor, `${op.op}.anchor`);
        const targetKind = parseTargetKind(op.targetKind);
        return {
          op: op.op,
          ...(optionalPath ? { path: optionalPath } : {}),
          anchor,
          text: checkedText(op.text, `${op.op}.text`),
          ...(targetKind ? { targetKind } : {}),
        };
      }
      throw new Error("Model proposals may only contain replace_text/insert operations");
    });
    return {
      ok: true,
      proposal: {
        schemaVersion: PATCH_SCHEMA_VERSION,
        summary: raw.summary,
        operations,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof UnsafeProjectPathError ? "UNSAFE_PATH" : "INVALID_PATCH",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
