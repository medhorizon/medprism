import { normalizeDoi, normalizeTitle } from "./bibtex";
import type { PaperHit, ToolDef } from "./types";

const EUROPE_PMC_SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const EUROPE_PMC_TIMEOUT_MS = 20_000;

export async function searchEuropePmc(
  query: string,
  pageSize = 5,
  timeoutMs = EUROPE_PMC_TIMEOUT_MS,
): Promise<PaperHit[]> {
  const q = query.trim();
  if (!q) return [];
  const url = new URL(EUROPE_PMC_SEARCH);
  url.searchParams.set("query", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", String(Math.min(10, Math.max(1, pageSize))));
  url.searchParams.set("resultType", "core");
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url.toString(), { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Europe PMC search timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Europe PMC HTTP ${response.status}`);
  const data = (await response.json()) as { resultList?: { result?: EuropePmcResult[] } };
  const seen = new Set<string>();
  return (data.resultList?.result ?? [])
    .map(normalizeHit)
    .filter((hit) => hit.title)
    .filter((hit) => {
      const identity = normalizeDoi(hit.doi)
        ? `doi:${normalizeDoi(hit.doi)}`
        : hit.pmid?.trim()
          ? `pmid:${hit.pmid.trim()}`
          : `title:${normalizeTitle(hit.title)}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

type EuropePmcResult = {
  id?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  pubYear?: string | number;
  journalTitle?: string;
  abstractText?: string;
};

function normalizeHit(row: EuropePmcResult): PaperHit {
  const rawPmid = row.pmid || (row.id && /^\d+$/.test(row.id) ? row.id : undefined);
  const pmid = rawPmid && /^\d+$/.test(rawPmid.trim()) ? rawPmid.trim() : undefined;
  const rawDoi = row.doi?.trim().toLowerCase();
  const doi = rawDoi && /^10\.\d{4,9}\/\S+$/i.test(rawDoi) ? rawDoi : undefined;
  const year = row.pubYear == null ? undefined : String(row.pubYear);
  const journal = row.journalTitle?.trim();
  const abstract = row.abstractText?.replace(/<\/?[^>]+>/g, "").trim();
  return {
    id: pmid || doi || row.id || crypto.randomUUID(),
    title: (row.title || "").replace(/<\/?[^>]+>/g, "").trim(),
    authors: row.authorString || "",
    ...(year ? { year } : {}),
    ...(doi ? { doi } : {}),
    ...(pmid ? { pmid } : {}),
    ...(journal ? { journal } : {}),
    ...(abstract ? { abstract } : {}),
    source: "europe-pmc",
  };
}

export const paperSearchTool: ToolDef = {
  name: "paper_search",
  description:
    "Search Europe PMC. Returns trusted structured metadata; no model-generated BibTeX or identifiers.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      pageSize: { type: "number" },
    },
    required: ["query"],
  },
  async execute(args) {
    const query = String(args.query ?? "").trim();
    if (!query) return { ok: false, error: "query is required", code: "INVALID_QUERY" };
    try {
      const hits = await searchEuropePmc(query, Number(args.pageSize ?? 5));
      return { ok: true, data: { query, count: hits.length, hits } };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "paper_search failed",
        code: "SEARCH_FAILED",
      };
    }
  },
};
