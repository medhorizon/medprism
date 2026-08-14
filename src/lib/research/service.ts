import type { PaperHit, ToolContext, ToolResult } from "../../tools/types";
import type {
  ResearchBundle,
  ResearchReport,
  ResearchSpec,
} from "./types";

export type TrustedPaperSearchPayload = {
  query?: string;
  count?: number;
  hits: PaperHit[];
  warnings?: string[];
};

export type ResearchStageErrorCode =
  | "MISSING_QUERY"
  | "SEARCH_FAILED"
  | "INVALID_SEARCH_RESULT"
  | "NO_RESULTS"
  | "NO_ABSTRACT_EVIDENCE";

export type ResearchStageResult =
  | { ok: true; bundle: ResearchBundle }
  | { ok: false; code: ResearchStageErrorCode; message: string };

/** Validate the minimum stable contract returned by paper_search. */
export function parseTrustedPaperSearchPayload(
  value: unknown,
): { ok: true; payload: TrustedPaperSearchPayload } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "paper_search returned a non-object payload" };
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.hits)) {
    return { ok: false, message: "paper_search payload is missing hits[]" };
  }

  const ids = new Set<string>();
  const hits: PaperHit[] = [];
  for (const raw of record.hits) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, message: "paper_search returned an invalid hit" };
    }
    const hit = raw as Record<string, unknown>;
    const optionalStringFields = ["year", "doi", "pmid", "journal", "abstract", "source"] as const;
    const invalidOptionalField = optionalStringFields.find(
      (field) => hit[field] !== undefined && typeof hit[field] !== "string",
    );
    if (
      typeof hit.id !== "string" ||
      !hit.id.trim() ||
      typeof hit.title !== "string" ||
      !hit.title.trim() ||
      typeof hit.authors !== "string" ||
      ids.has(hit.id) ||
      invalidOptionalField !== undefined
    ) {
      return { ok: false, message: "paper_search returned an incomplete or duplicate hit" };
    }
    ids.add(hit.id);
    hits.push({
      id: hit.id,
      title: hit.title,
      authors: hit.authors,
      ...(typeof hit.year === "string" ? { year: hit.year } : {}),
      ...(typeof hit.doi === "string" ? { doi: hit.doi } : {}),
      ...(typeof hit.pmid === "string" ? { pmid: hit.pmid } : {}),
      ...(typeof hit.journal === "string" ? { journal: hit.journal } : {}),
      ...(typeof hit.abstract === "string" ? { abstract: hit.abstract } : {}),
      ...(typeof hit.source === "string" ? { source: hit.source } : {}),
    });
  }

  if (record.warnings !== undefined) {
    if (
      !Array.isArray(record.warnings) ||
      record.warnings.some((warning) => typeof warning !== "string")
    ) {
      return { ok: false, message: "paper_search warnings must be a string array" };
    }
  }

  return {
    ok: true,
    payload: {
      hits,
      ...(typeof record.query === "string" ? { query: record.query } : {}),
      ...(typeof record.count === "number" ? { count: record.count } : {}),
      ...(Array.isArray(record.warnings) ? { warnings: record.warnings as string[] } : {}),
    },
  };
}

/** Keep model context bounded while preserving trusted identifiers and abstracts. */
export function compactPaperHits(
  hits: readonly PaperHit[],
  abstractLimit = 1_600,
): PaperHit[] {
  return hits.map((hit) => ({
    ...hit,
    ...(hit.abstract ? { abstract: hit.abstract.slice(0, abstractLimit) } : {}),
  }));
}

function normalizedQuery(value: string | undefined): string | undefined {
  const query = value?.replace(/\s+/g, " ").trim();
  if (!query || query.length < 2 || query.length > 1_000) return undefined;
  return query;
}

function publicationYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const year = Number.parseInt(value, 10);
  return Number.isInteger(year) ? year : undefined;
}

/** Resolve the query without sending the raw user instruction to paper_search. */
export function resolveResearchQuery(args: {
  spec: ResearchSpec;
  userText: string;
  selectedText?: string;
  formulatedQuery?: string;
}): string | undefined {
  const formulated = normalizedQuery(args.formulatedQuery);
  const explicit = normalizedQuery(args.spec.query);
  const selection = normalizedQuery(args.selectedText);

  if (args.spec.purpose === "citation") {
    return formulated ?? selection ?? explicit;
  }
  // Never send the full user instruction (for example, “research HCC and write
  // Methods”) to the literature connector as a fallback query.
  return formulated ?? explicit ?? selection;
}

export async function runResearchStage(args: {
  spec: ResearchSpec;
  userText: string;
  selectedText?: string;
  formulatedQuery?: string;
  ctx: ToolContext;
  runTool: (
    name: string,
    toolArgs: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
}): Promise<ResearchStageResult> {
  const query = resolveResearchQuery({
    spec: args.spec,
    userText: args.userText,
    ...(args.selectedText !== undefined ? { selectedText: args.selectedText } : {}),
    ...(args.formulatedQuery !== undefined ? { formulatedQuery: args.formulatedQuery } : {}),
  });
  if (!query) {
    return {
      ok: false,
      code: "MISSING_QUERY",
      message: "Research requires an explicit topic or selected claim.",
    };
  }

  const pageSize = Math.max(1, Math.min(20, args.spec.pageSize ?? 8));
  const searched = await args.runTool("paper_search", { query, pageSize }, args.ctx);
  if (!searched.ok) {
    return {
      ok: false,
      code: "SEARCH_FAILED",
      message: `Literature search failed: ${searched.error}`,
    };
  }
  const parsed = parseTrustedPaperSearchPayload(searched.data);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "INVALID_SEARCH_RESULT",
      message: parsed.message,
    };
  }
  const sinceYear = args.spec.sinceYear;
  const datedHits = sinceYear == null
    ? parsed.payload.hits
    : parsed.payload.hits.filter((hit) => {
        const year = publicationYear(hit.year);
        return year == null || year >= sinceYear;
      });
  const droppedByYear = parsed.payload.hits.length - datedHits.length;
  if (datedHits.length === 0) {
    return {
      ok: false,
      code: "NO_RESULTS",
      message: `No literature results were found for “${query}”.`,
    };
  }
  if (args.spec.requireAbstract && !datedHits.some((hit) => Boolean(hit.abstract))) {
    return {
      ok: false,
      code: "NO_ABSTRACT_EVIDENCE",
      message: `The search for “${query}” returned title-only candidates without abstract-level evidence.`,
    };
  }

  const warnings: string[] = [...(parsed.payload.warnings ?? [])];
  if (droppedByYear > 0) {
    warnings.push(`${droppedByYear} candidate(s) were older than ${sinceYear}.`);
  }
  const abstractCount = datedHits.filter((hit) => Boolean(hit.abstract)).length;
  if (abstractCount < datedHits.length) {
    warnings.push(
      `${datedHits.length - abstractCount} candidate(s) have title-level metadata only.`,
    );
  }
  return {
    ok: true,
    bundle: {
      query,
      purpose: args.spec.purpose,
      hits: datedHits,
      warnings,
    },
  };
}

export function validateResearchUse(
  value: unknown,
  bundle: ResearchBundle,
  requireAtLeastOne = true,
): { ok: true; sourceCandidateIds: string[] } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "researchUse must be an object" };
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["sourceCandidateIds"]);
  const unexpected = Object.keys(record).find((key) => !allowed.has(key));
  if (unexpected) {
    return { ok: false, message: `researchUse contains unsupported field: ${unexpected}` };
  }
  if (
    !Array.isArray(record.sourceCandidateIds) ||
    record.sourceCandidateIds.some((id) => typeof id !== "string")
  ) {
    return { ok: false, message: "researchUse.sourceCandidateIds must be a string array" };
  }
  const ids = [...new Set(record.sourceCandidateIds as string[])];
  if (requireAtLeastOne && ids.length === 0) {
    return { ok: false, message: "Research-assisted text must identify at least one trusted source candidate" };
  }
  const trusted = new Map(bundle.hits.map((hit) => [hit.id, hit]));
  const unknown = ids.find((id) => !trusted.has(id));
  if (unknown) {
    return { ok: false, message: `Research result references an untrusted candidate: ${unknown}` };
  }
  const titleOnly = ids.find((id) => !trusted.get(id)?.abstract);
  if (titleOnly && bundle.purpose !== "citation") {
    return {
      ok: false,
      message: `Research-assisted prose may not rely on title-only candidate: ${titleOnly}`,
    };
  }
  return { ok: true, sourceCandidateIds: ids };
}

export function researchReportFromBundle(bundle: ResearchBundle): ResearchReport {
  return {
    schemaVersion: "1",
    query: bundle.query,
    candidates: bundle.hits.map((hit) => ({
      id: hit.id,
      title: hit.title,
      authors: hit.authors,
      ...(hit.year ? { year: hit.year } : {}),
      ...(hit.journal ? { journal: hit.journal } : {}),
      ...(hit.doi ? { doi: hit.doi } : {}),
      ...(hit.pmid ? { pmid: hit.pmid } : {}),
      hasAbstract: Boolean(hit.abstract),
    })),
    warnings: [...bundle.warnings],
  };
}
