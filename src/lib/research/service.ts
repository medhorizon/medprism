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

  return {
    ok: true,
    payload: {
      hits,
      ...(typeof record.query === "string" ? { query: record.query } : {}),
      ...(typeof record.count === "number" ? { count: record.count } : {}),
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

/** Resolve the query without delegating query ownership to the language model. */
export function resolveResearchQuery(args: {
  spec: ResearchSpec;
  userText: string;
  selectedText?: string;
}): string | undefined {
  const explicit = normalizedQuery(args.spec.query);
  const selection = normalizedQuery(args.selectedText);

  if (args.spec.purpose === "citation") {
    return selection ?? explicit;
  }
  // The router/runtime must own the research query. Never send the full user
  // instruction (for example, “research HCC and write Methods”) to the
  // literature connector as a fallback query.
  return explicit ?? selection;
}

export async function runResearchStage(args: {
  spec: ResearchSpec;
  userText: string;
  selectedText?: string;
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
  if (parsed.payload.hits.length === 0) {
    return {
      ok: false,
      code: "NO_RESULTS",
      message: `No literature results were found for “${query}”.`,
    };
  }
  if (args.spec.requireAbstract && !parsed.payload.hits.some((hit) => Boolean(hit.abstract))) {
    return {
      ok: false,
      code: "NO_ABSTRACT_EVIDENCE",
      message: `The search for “${query}” returned title-only candidates without abstract-level evidence.`,
    };
  }

  const warnings: string[] = [];
  const abstractCount = parsed.payload.hits.filter((hit) => Boolean(hit.abstract)).length;
  if (abstractCount < parsed.payload.hits.length) {
    warnings.push(
      `${parsed.payload.hits.length - abstractCount} candidate(s) have title-level metadata only.`,
    );
  }
  return {
    ok: true,
    bundle: {
      query,
      purpose: args.spec.purpose,
      hits: parsed.payload.hits,
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
