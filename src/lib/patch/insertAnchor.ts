import { parseTargetKind } from "../latex/targetKind";
import {
  inferLatexTargetKindFromDraft,
  trustedInsertPlacement,
} from "../latex/textTargets";
import type { LatexTargetKind } from "../latex/types";

function occurrenceCount(source: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= source.length) {
    const index = source.indexOf(needle, from);
    if (index < 0) break;
    count += 1;
    from = index + Math.max(needle.length, 1);
  }
  return count;
}

const LAST_RESORT_PATTERNS = [
  /\\end\s*\{\s*document\s*\}/i,
  /\\printbibliography\b/i,
  /\\bibliography\s*\{[^}]+\}/i,
  /\\begin\s*\{\s*thebibliography\s*\}/i,
];

const INSERT_OP_ALIASES = new Set([
  "insert",
  "insert_before",
  "insert_after",
  "add",
  "create",
  "append",
  "write",
  "upsert",
  "section",
  "add_section",
  "create_section",
  "insert_text",
  "add_text",
]);

const REPLACE_OP_ALIASES = new Set([
  "replace_text",
  "replace",
  "edit",
  "update_text",
  "update",
]);

export type ResolvedInsertPlacement = {
  op: "insert_before" | "insert_after";
  anchor: string;
  /** How the runtime chose the placement (for tests / diagnostics). */
  via: "semantic-target" | "unique-preferred" | "last-resort";
};

/**
 * Place an insert at the structurally correct position when possible.
 * Order: semantic target (model targetKind or inferred from draft) →
 * unique model-supplied anchor → last-resort back-matter marker.
 */
export function resolveInsertPlacement(args: {
  source: string;
  text: string;
  preferredAnchor?: string;
  targetKind?: LatexTargetKind;
  proposedOp?: "insert_before" | "insert_after";
}): ResolvedInsertPlacement | null {
  const kind = args.targetKind ?? inferLatexTargetKindFromDraft(args.text);
  if (kind) {
    const placement = trustedInsertPlacement(args.source, kind);
    if (placement) {
      return {
        op: placement.mode,
        anchor: placement.anchor,
        via: "semantic-target",
      };
    }
  }

  const preferred = args.preferredAnchor?.trim() ?? "";
  if (preferred && occurrenceCount(args.source, preferred) === 1) {
    return {
      op: args.proposedOp ?? "insert_before",
      anchor: preferred,
      via: "unique-preferred",
    };
  }

  for (const pattern of LAST_RESORT_PATTERNS) {
    const match = args.source.match(pattern);
    if (match?.[0] && occurrenceCount(args.source, match[0]) === 1) {
      return {
        op: "insert_before",
        anchor: match[0],
        via: "last-resort",
      };
    }
  }
  return null;
}

/** @deprecated Prefer resolveInsertPlacement; kept for narrow unique-anchor checks. */
export function resolveTrustedInsertAnchor(
  source: string,
  preferred?: string,
): string | null {
  return (
    resolveInsertPlacement({
      source,
      text: "",
      preferredAnchor: preferred,
      proposedOp: "insert_before",
    })?.anchor ?? null
  );
}

export function placeholderLatexForTargetKind(kind: LatexTargetKind): string {
  switch (kind) {
    case "title":
      return "\\title{[Title]}\n";
    case "abstract":
      return "\\begin{abstract}\n% TODO\n\\end{abstract}\n";
    case "keywords":
      return "\\keywords{[keyword1, keyword2, keyword3]}\n";
    case "introduction":
      return "\\section{Introduction}\n\n";
    case "methods":
      return "\\section{Methods}\n\n";
    case "results":
      return "\\section{Results}\n\n";
    case "discussion":
      return "\\section{Discussion}\n\n";
    case "conclusion":
      return "\\section{Conclusion}\n\n";
    case "funding":
      return "\\section*{Funding}\n\n";
    case "acknowledgements":
      return "\\section*{Acknowledgements}\n\n";
    case "author-contributions":
      return "\\section*{Author contributions}\n\n";
    case "data-availability":
      return "\\section*{Data availability}\n\n";
    case "ethics":
      return "\\section*{Ethics approval and consent to participate}\n\n";
    case "conflict-of-interest":
      return "\\section*{Competing interests}\n\n";
    case "body":
      return "% TODO: body\n\n";
    case "section":
      return "\\section{[Section title]}\n\n";
    case "selection":
      return "";
  }
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function looksLikeLatexDraft(text: string): boolean {
  return /\\(?:section|subsection|title|abstract|keywords|begin|author|maketitle)\b/i.test(
    text,
  );
}

const RUNTIME_OWNED_OP_FIELDS = [
  "baseSha256",
  "range",
  "expectedOccurrences",
  "entries",
  "mustNotExist",
  "citeKey",
  "bibtex",
  "doi",
  "pmid",
] as const;

function coerceOperation(item: unknown): Record<string, unknown> | null {
  if (typeof item === "string") {
    const text = item.trim();
    if (!text) return null;
    return {
      op: "insert_before",
      anchor: "",
      text: text.endsWith("\n") ? text : `${text}\n`,
    };
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const op = item as Record<string, unknown>;
  // Keep runtime-owned fields intact so schema parsing can reject them.
  if (RUNTIME_OWNED_OP_FIELDS.some((field) => op[field] !== undefined)) {
    return { ...op };
  }
  const opName = typeof op.op === "string" ? op.op.trim().toLowerCase() : "";
  const targetKind = parseTargetKind(op.targetKind ?? op.kind ?? op.target);
  const text =
    firstNonEmptyString(
      op.text,
      op.content,
      op.newText,
      op.latex,
      op.body,
      op.value,
      op.source,
    ) ?? (targetKind ? placeholderLatexForTargetKind(targetKind) : undefined);

  if (REPLACE_OP_ALIASES.has(opName)) {
    const oldText = firstNonEmptyString(op.oldText, op.before, op.from);
    const newText = firstNonEmptyString(op.newText, op.after, op.to, op.text, op.content);
    if (oldText === undefined || newText === undefined) return null;
    const next: Record<string, unknown> = {
      op: "replace_text",
      oldText,
      newText,
    };
    if (typeof op.path === "string") next.path = op.path;
    return next;
  }

  const insertish =
    INSERT_OP_ALIASES.has(opName) ||
    (!opName && Boolean(text) && (Boolean(targetKind) || looksLikeLatexDraft(text ?? "")));
  if (!insertish || text === undefined) return null;

  const next: Record<string, unknown> = {
    op: opName === "insert_after" ? "insert_after" : "insert_before",
    anchor: typeof op.anchor === "string" ? op.anchor : "",
    text,
  };
  if (typeof op.path === "string") next.path = op.path;
  if (targetKind) next.targetKind = targetKind;
  return next;
}

/**
 * Normalize messy model patch proposals before schema parsing:
 * - aliases like add/create/append → insert_before
 * - content/newText/latex → text
 * - bare LaTeX strings → insert_before
 * - targetKind-only ops → placeholder LaTeX
 */
export function softenRawPatchProposal(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.operations)) return value;

  const operations = raw.operations
    .map((item) => coerceOperation(item))
    .filter((item): item is Record<string, unknown> => item !== null);

  if (operations.length === 0) return value;
  return {
    ...raw,
    operations,
  };
}
