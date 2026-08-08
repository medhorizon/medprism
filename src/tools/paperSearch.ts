import { citeKey, paperHitToBibtex } from "./bibtex";
import type { PaperHit, ToolDef } from "./types";

const EUROPE_PMC_SEARCH =
  "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

export async function searchEuropePmc(query: string, pageSize = 5): Promise<PaperHit[]> {
  const q = query.trim();
  if (!q) return [];

  const url = new URL(EUROPE_PMC_SEARCH);
  url.searchParams.set("query", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", String(Math.min(10, Math.max(1, pageSize))));
  url.searchParams.set("resultType", "core");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Europe PMC HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    resultList?: { result?: EuropePmcResult[] };
  };
  const rows = data.resultList?.result ?? [];
  return rows.map(normalizeHit).filter((h): h is PaperHit => !!h.title);
}

type EuropePmcResult = {
  id?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  pubYear?: string | number;
  journalTitle?: string;
};

function normalizeHit(row: EuropePmcResult): PaperHit {
  const pmid = row.pmid || (row.id && /^\d+$/.test(row.id) ? row.id : undefined);
  return {
    id: pmid || row.doi || row.id || crypto.randomUUID(),
    title: (row.title || "").replace(/<\/?[^>]+>/g, "").trim(),
    authors: row.authorString || "",
    year: row.pubYear != null ? String(row.pubYear) : undefined,
    doi: row.doi,
    pmid,
    journal: row.journalTitle,
  };
}

export const paperSearchTool: ToolDef = {
  name: "paper_search",
  description:
    "Search Europe PMC for biomedical papers. Returns structured hits and deterministic BibTeX. Never invent citations.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query, e.g. Sepsis-3 Singer 2016" },
      pageSize: { type: "number", description: "Max results (1-10)" },
    },
    required: ["query"],
  },
  async execute(args) {
    const query = String(args.query ?? "").trim();
    if (!query) return { ok: false, error: "query is required" };
    const pageSize = Number(args.pageSize ?? 5);
    try {
      const hits = await searchEuropePmc(query, pageSize);
      const withBib = hits.map((hit) => ({
        ...hit,
        citeKey: citeKey(hit),
        bibtex: paperHitToBibtex(hit),
      }));
      return {
        ok: true,
        data: {
          query,
          count: withBib.length,
          hits: withBib,
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "paper_search failed",
      };
    }
  },
};
