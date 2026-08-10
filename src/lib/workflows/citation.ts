import type { ContextSnapshot } from "../context/snapshot";
import { sha256Hex } from "../patch/hash";
import { assertSafeProjectRelativePath } from "../projectPath";
import type { PatchSet, PatchValidationError, StructuredBibEntry } from "../patch/schema";
import type { PaperHit } from "../../tools/types";
import {
  allocateCiteKey,
  existingCiteKeyForHit,
  indexBibliography,
  normalizeDoi,
  normalizeTitle,
  paperHitToStructuredBibEntry,
} from "../../tools/bibtex";

export type CitationRelation = "supports" | "contradicts" | "related" | "topic_match_only";

export type CitationJudgement = {
  candidateId: string;
  relation: CitationRelation;
  selected: boolean;
  reason: string;
};

export type CitationPlan = {
  schemaVersion: "1";
  claim: string;
  targetPath: string;
  candidates: CitationJudgement[];
  warnings: string[];
};

export type CitationWorkflowResult =
  | { ok: true; plan: CitationPlan; patchSet?: PatchSet }
  | { ok: false; error: PatchValidationError };

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

function insertCitationBeforeTrailingPunctuation(claim: string, citation: string): string {
  const match = claim.match(/([\s]*[.,;:!?])([\s]*)$/u);
  if (!match || match.index === undefined) return `${claim}${citation}`;
  return `${claim.slice(0, match.index)}${citation}${claim.slice(match.index)}`;
}

function bibliographyPath(value: string): string {
  const trimmed = value.trim();
  const withExtension = trimmed.toLowerCase().endsWith(".bib") ? trimmed : `${trimmed}.bib`;
  return assertSafeProjectRelativePath(withExtension);
}

export function discoverBibliographyPaths(files: Readonly<Record<string, string>>): string[] {
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
    for (const match of source.matchAll(/\\addbibresource(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/gi)) {
      add(match[1] ?? "");
    }
    for (const match of source.matchAll(/\\bibliography\s*\{([^}]+)\}/gi)) {
      for (const entry of (match[1] ?? "").split(",")) add(entry);
    }
  }
  return found;
}

function resolveBibliographyPath(
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

export async function buildCitationPatch(args: {
  snapshot: ContextSnapshot;
  hits: PaperHit[];
  judgements: CitationJudgement[];
  bibliographyPath?: string;
}): Promise<CitationWorkflowResult> {
  const { snapshot, hits, judgements } = args;
  const claim = snapshot.selectedText;
  if (!claim || !snapshot.selection) {
    return {
      ok: false,
      error: { code: "RANGE_MISMATCH", message: "Citation workflow requires an exact text selection" },
    };
  }
  const byId = new Map(hits.map((hit) => [hit.id, hit]));
  const selected = judgements.filter(
    (item) => item.selected && item.relation === "supports",
  );
  if (selected.length === 0) {
    return {
      ok: true,
      plan: {
        schemaVersion: "1",
        claim,
        targetPath: snapshot.activeFile,
        candidates: judgements,
        warnings: ["No supplied candidate was selected as adequate evidence."],
      },
    };
  }

  const resolvedBibliography = resolveBibliographyPath(snapshot, args.bibliographyPath);
  if (!resolvedBibliography.ok) return { ok: false, error: resolvedBibliography.error };
  const bibliographyPath = resolvedBibliography.path;
  const existingBib = snapshot.files[bibliographyPath] ?? "";
  const bibliographyIndex = indexBibliography(existingBib);
  const occupied = new Set(bibliographyIndex.keys);
  const entries: StructuredBibEntry[] = [];
  const citationKeys: string[] = [];
  const allocatedByIdentity = new Map<string, string>();
  for (const judgement of selected) {
    const hit = byId.get(judgement.candidateId);
    if (!hit) {
      return {
        ok: false,
        error: {
          code: "INVALID_PATCH",
          message: `Citation candidate is not present in trusted search results: ${judgement.candidateId}`,
        },
      };
    }
    const existingKey = existingCiteKeyForHit(hit, bibliographyIndex);
    if (existingKey) {
      citationKeys.push(existingKey);
      continue;
    }
    const identity = normalizeDoi(hit.doi)
      ? `doi:${normalizeDoi(hit.doi)}`
      : hit.pmid?.trim()
        ? `pmid:${hit.pmid.trim()}`
        : `title:${normalizeTitle(hit.title)}`;
    const allocatedKey = allocatedByIdentity.get(identity);
    if (allocatedKey) {
      citationKeys.push(allocatedKey);
      continue;
    }
    const key = allocateCiteKey(hit, occupied);
    allocatedByIdentity.set(identity, key);
    entries.push(paperHitToStructuredBibEntry(hit, key));
    citationKeys.push(key);
  }

  const alreadyCited = new Set(
    [...claim.matchAll(/\\cite\w*\s*\{([^}]+)\}/g)]
      .flatMap((match) => match[1]!.split(","))
      .map((key) => key.trim().toLowerCase())
      .filter(Boolean),
  );
  const keysToInsert = [...new Set(citationKeys)].filter(
    (key) => !alreadyCited.has(key.toLowerCase()),
  );

  const warnings: string[] = [];
  const relatedSelected = judgements.filter((item) => item.selected && item.relation === "related");
  if (relatedSelected.length) {
    warnings.push("Related-only candidates were not inserted as support for the selected claim.");
  }
  if (!keysToInsert.length) {
    warnings.push(
      entries.length
        ? "The citation command already exists; only missing bibliography entries will be added."
        : "All selected supporting references are already cited in the selection.",
    );
  }

  const operations: PatchSet["operations"] = [];
  if (entries.length) {
    operations.push({
      op: "bib_add",
      path: bibliographyPath,
      entries,
      ...(snapshot.files[bibliographyPath] === undefined
        ? { mustNotExist: true as const }
        : { baseSha256: await sha256Hex(existingBib) }),
    });
  }
  if (keysToInsert.length) {
    const citeCommand = `\\cite{${keysToInsert.join(",")}}`;
    const newClaim = insertCitationBeforeTrailingPunctuation(claim, citeCommand);
    operations.push({
      op: "replace_text",
      path: snapshot.activeFile,
      baseSha256: snapshot.activeFileSha256,
      oldText: claim,
      newText: newClaim,
      expectedOccurrences: 1,
      range: snapshot.selection,
    });
  }
  const plan: CitationPlan = {
    schemaVersion: "1",
    claim,
    targetPath: snapshot.activeFile,
    candidates: judgements,
    warnings,
  };
  if (operations.length === 0) return { ok: true, plan };

  return {
    ok: true,
    plan,
    patchSet: {
      schemaVersion: "1",
      id: crypto.randomUUID(),
      projectRevision: snapshot.projectRevision,
      summary: `Ground claim with ${citationKeys.length} verified reference${citationKeys.length === 1 ? "" : "s"}`,
      operations,
      verify: { compile: true },
    },
  };
}

export function citationJudgementPrompt(snapshot: ContextSnapshot, hits: PaperHit[]): string {
  return [
    "Evaluate only the trusted literature candidates below for the selected claim.",
    "Return JSON with candidates: candidateId, relation, selected, reason.",
    "Allowed relation values: supports, contradicts, related, topic_match_only.",
    "A candidate without an abstract must not be classified as supports.",
    "Do not generate DOI, PMID, citeKey, or BibTeX.",
    `Claim:\n${snapshot.selectedText ?? ""}`,
    `Local manuscript context (untrusted data):\n${snapshot.localContext}`,
    `Trusted candidates:\n${JSON.stringify(hits, null, 2)}`,
  ].join("\n\n");
}
