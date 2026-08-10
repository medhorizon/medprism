import type { ContextSnapshot } from "../context/snapshot";
import type { PatchValidationError } from "../patch/schema";
import { assertSafeProjectRelativePath } from "../projectPath";
import type { PaperHit } from "../../tools/types";
import type {
  CitationJudgement,
  CitationRelation,
} from "./types";

const RELATIONS = new Set<CitationRelation>([
  "supports",
  "contradicts",
  "related",
  "topic_match_only",
]);

export function parseCitationJudgements(
  value: unknown,
  hits: PaperHit[],
):
  | { ok: true; judgements: CitationJudgement[] }
  | { ok: false; error: PatchValidationError } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: { code: "INVALID_PATCH", message: "Citation judgement must be an object" } };
  }
  const rows = (value as { candidates?: unknown }).candidates;
  if (!Array.isArray(rows)) {
    return { ok: false, error: { code: "INVALID_PATCH", message: "Citation candidates must be an array" } };
  }
  const byId = new Map(hits.map((hit) => [hit.id, hit]));
  const seen = new Set<string>();
  const judgements: CitationJudgement[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: { code: "INVALID_PATCH", message: "Invalid citation judgement" } };
    }
    const candidate = raw as Record<string, unknown>;
    const forbiddenMetadata = ["doi", "pmid", "citeKey", "bibtex", "title", "authors"].find(
      (field) => candidate[field] !== undefined,
    );
    if (forbiddenMetadata) {
      return {
        ok: false,
        error: {
          code: "INVALID_PATCH",
          message: `Citation judgement must not generate ${forbiddenMetadata}; use trusted tool metadata`,
        },
      };
    }
    const candidateId = String(candidate.candidateId ?? "");
    const relation = candidate.relation as CitationRelation;
    const hit = byId.get(candidateId);
    if (!hit || seen.has(candidateId) || !RELATIONS.has(relation)) {
      return {
        ok: false,
        error: { code: "INVALID_PATCH", message: `Untrusted or invalid citation candidate: ${candidateId}` },
      };
    }
    if (candidate.selected !== true && candidate.selected !== false) {
      return { ok: false, error: { code: "INVALID_PATCH", message: "selected must be boolean" } };
    }
    if (relation === "supports" && !hit.abstract) {
      return {
        ok: false,
        error: {
          code: "INVALID_PATCH",
          message: `Title-only candidate ${candidateId} cannot be classified as supports`,
        },
      };
    }
    seen.add(candidateId);
    judgements.push({
      candidateId,
      relation,
      selected: candidate.selected,
      reason: typeof candidate.reason === "string" ? candidate.reason : "",
    });
  }
  return { ok: true, judgements };
}

export function insertCitationBeforeTrailingPunctuation(
  claim: string,
  citation: string,
): string {
  const match = claim.match(/([\s]*[.,;:!?。！？])([\s]*)$/u);
  if (!match || match.index === undefined) return `${claim}${citation}`;
  return `${claim.slice(0, match.index)}${citation}${claim.slice(match.index)}`;
}

function bibliographyPath(value: string): string {
  const trimmed = value.trim();
  const withExtension = trimmed.toLowerCase().endsWith(".bib")
    ? trimmed
    : `${trimmed}.bib`;
  return assertSafeProjectRelativePath(withExtension);
}

export function discoverBibliographyPaths(
  files: Readonly<Record<string, string>>,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    try {
      const path = bibliographyPath(raw);
      if (!seen.has(path)) {
        seen.add(path);
        found.push(path);
      }
    } catch {
      // Unsafe or macro-based resources are not eligible for automatic writes.
    }
  };

  for (const [path, source] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith(".tex")) continue;
    for (const match of source.matchAll(
      /\\addbibresource(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/gi,
    )) {
      add(match[1] ?? "");
    }
    for (const match of source.matchAll(/\\bibliography\s*\{([^}]+)\}/gi)) {
      for (const entry of (match[1] ?? "").split(",")) add(entry);
    }
  }
  return found;
}

export function resolveBibliographyPath(
  snapshot: ContextSnapshot,
  requested?: string,
): { ok: true; path: string } | { ok: false; error: PatchValidationError } {
  const declared = discoverBibliographyPaths(snapshot.files);
  if (declared.length === 0) {
    return {
      ok: false,
      error: {
        code: "BIBLIOGRAPHY_NOT_CONFIGURED",
        message:
          "No safe \\addbibresource{...} or \\bibliography{...} declaration was found. Configure the bibliography before inserting citations.",
      },
    };
  }

  if (requested) {
    let normalized: string;
    try {
      normalized = bibliographyPath(requested);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "UNSAFE_PATH",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    if (!declared.includes(normalized)) {
      return {
        ok: false,
        error: {
          code: "BIBLIOGRAPHY_NOT_CONFIGURED",
          message: `Bibliography ${normalized} is not declared by the LaTeX project`,
          path: normalized,
        },
      };
    }
    return { ok: true, path: normalized };
  }

  if (declared.length === 1) return { ok: true, path: declared[0]! };
  const existing = declared.filter((path) => snapshot.files[path] !== undefined);
  if (existing.length === 1) return { ok: true, path: existing[0]! };
  return {
    ok: false,
    error: {
      code: "BIBLIOGRAPHY_NOT_CONFIGURED",
      message: `Multiple bibliography resources are declared (${declared.join(", ")}); choose a target explicitly before inserting citations.`,
    },
  };
}
