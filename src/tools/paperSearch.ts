import { normalizeDoi, normalizeTitle } from "./bibtex";
import { mergeUniquePaperHits } from "./paperHits";
import type { PaperHit, ToolDef } from "./types";

const SEARCH_TIMEOUT_MS = 20_000;
const EUROPE_PMC_SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const PUBMED_ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const CROSSREF_WORKS = "https://api.crossref.org/works";
const OPENALEX_WORKS = "https://api.openalex.org/works";

export type LiteratureSearchResult = {
  query: string;
  hits: PaperHit[];
  warnings: string[];
};

type SourceName = "europe-pmc" | "pubmed" | "biorxiv" | "crossref" | "openalex";

function boundedPageSize(pageSize: number): number {
  return Math.min(10, Math.max(1, pageSize));
}

function boundedLimit(pageSize: number): number {
  return Math.min(20, Math.max(1, pageSize));
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(value: string): string {
  return stripMarkup(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchResponse(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function fetchJson(url: string, timeoutMs = SEARCH_TIMEOUT_MS): Promise<unknown> {
  const response = await fetchResponse(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url: string, timeoutMs = SEARCH_TIMEOUT_MS): Promise<string> {
  const response = await fetchResponse(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
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

function europePmcHit(row: EuropePmcResult): PaperHit {
  const rawPmid = row.pmid || (row.id && /^\d+$/.test(row.id) ? row.id : undefined);
  const pmid = rawPmid && /^\d+$/.test(rawPmid.trim()) ? rawPmid.trim() : undefined;
  const doi = normalizeDoi(row.doi);
  const year = row.pubYear == null ? undefined : String(row.pubYear);
  const journal = row.journalTitle?.trim();
  const abstract = row.abstractText ? stripMarkup(row.abstractText) : undefined;
  return {
    id: pmid || doi || row.id || crypto.randomUUID(),
    title: stripMarkup(row.title || ""),
    authors: row.authorString || "",
    ...(year ? { year } : {}),
    ...(doi ? { doi } : {}),
    ...(pmid ? { pmid } : {}),
    ...(journal ? { journal } : {}),
    ...(abstract ? { abstract } : {}),
    source: "europe-pmc",
  };
}

export async function searchEuropePmc(
  query: string,
  pageSize = 5,
  timeoutMs = SEARCH_TIMEOUT_MS,
): Promise<PaperHit[]> {
  const q = query.trim();
  if (!q) return [];
  const url = new URL(EUROPE_PMC_SEARCH);
  url.searchParams.set("query", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", String(boundedPageSize(pageSize)));
  url.searchParams.set("resultType", "core");
  let data: { resultList?: { result?: EuropePmcResult[] } };
  try {
    data = (await fetchJson(url.toString(), timeoutMs)) as { resultList?: { result?: EuropePmcResult[] } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("timed out")) {
      throw new Error(`Europe PMC search timed out after ${timeoutMs} ms`);
    }
    if (message.startsWith("HTTP ")) throw new Error(`Europe PMC ${message}`);
    throw error;
  }
  const seen = new Set<string>();
  return (data.resultList?.result ?? [])
    .map(europePmcHit)
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

function xmlTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1] ? decodeXml(match[1]) : undefined;
}

function xmlAttrTag(block: string, tag: string, attr: string, value: string): string | undefined {
  const match = block.match(
    new RegExp(`<${tag}[^>]*${attr}="${value}"[^>]*>([\\s\\S]*?)</${tag}>`, "i"),
  );
  return match?.[1] ? decodeXml(match[1]) : undefined;
}

function parsePubmedArticle(block: string): PaperHit | undefined {
  const pmid = xmlTag(block, "PMID");
  const title = xmlTag(block, "ArticleTitle");
  if (!title) return undefined;
  const authors = [...block.matchAll(/<Author\b[\s\S]*?<\/Author>/gi)]
    .map((match) => {
      const last = xmlTag(match[0], "LastName");
      const initials = xmlTag(match[0], "Initials");
      if (last && initials) return `${last} ${initials}`;
      return last || xmlTag(match[0], "CollectiveName") || "";
    })
    .filter(Boolean)
    .join(", ");
  const doi =
    normalizeDoi(xmlAttrTag(block, "ELocationID", "EIdType", "doi")) ||
    normalizeDoi(xmlAttrTag(block, "ArticleId", "IdType", "doi"));
  const year = xmlTag(block, "Year");
  const journal = xmlTag(block, "Title") || xmlTag(block, "ISOAbbreviation");
  const abstractParts = [...block.matchAll(/<AbstractText(?:\s[^>]*)?>([\s\S]*?)<\/AbstractText>/gi)]
    .map((match) => decodeXml(match[1] ?? ""))
    .filter(Boolean);
  const abstract = abstractParts.join(" ") || undefined;
  return {
    id: pmid || doi || crypto.randomUUID(),
    title,
    authors,
    ...(year ? { year } : {}),
    ...(doi ? { doi } : {}),
    ...(pmid && /^\d+$/.test(pmid) ? { pmid } : {}),
    ...(journal ? { journal } : {}),
    ...(abstract ? { abstract } : {}),
    source: "pubmed",
  };
}

export function parsePubmedXml(xml: string): PaperHit[] {
  const articles = xml.match(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/gi) ?? [];
  return articles.map(parsePubmedArticle).filter((hit): hit is PaperHit => Boolean(hit?.title));
}

async function searchPubmed(query: string, pageSize: number): Promise<PaperHit[]> {
  const search = new URL(PUBMED_ESEARCH);
  search.searchParams.set("db", "pubmed");
  search.searchParams.set("retmode", "json");
  search.searchParams.set("retmax", String(boundedPageSize(pageSize)));
  search.searchParams.set("term", query);
  search.searchParams.set("tool", "medprism");
  const payload = (await fetchJson(search.toString())) as {
    esearchresult?: { idlist?: string[] };
  };
  const ids = (payload.esearchresult?.idlist ?? []).filter((id) => /^\d+$/.test(id));
  if (ids.length === 0) return [];
  const fetchUrl = new URL(PUBMED_EFETCH);
  fetchUrl.searchParams.set("db", "pubmed");
  fetchUrl.searchParams.set("retmode", "xml");
  fetchUrl.searchParams.set("id", ids.join(","));
  fetchUrl.searchParams.set("tool", "medprism");
  return parsePubmedXml(await fetchText(fetchUrl.toString()));
}

type CrossrefAuthor = { family?: string; given?: string; name?: string };
type CrossrefDate = { "date-parts"?: number[][] };
type CrossrefWork = {
  DOI?: string;
  title?: string[];
  author?: CrossrefAuthor[];
  abstract?: string;
  "container-title"?: string[];
  "published-print"?: CrossrefDate;
  "published-online"?: CrossrefDate;
  created?: CrossrefDate;
  "alternative-id"?: string[];
};

function crossrefYear(work: CrossrefWork): string | undefined {
  const parts =
    work["published-print"]?.["date-parts"]?.[0] ??
    work["published-online"]?.["date-parts"]?.[0] ??
    work.created?.["date-parts"]?.[0];
  const year = parts?.[0];
  return year ? String(year) : undefined;
}

function crossrefAuthors(authors: CrossrefAuthor[] | undefined): string {
  return (authors ?? [])
    .map((author) => {
      if (author.family && author.given) return `${author.family} ${author.given[0] ?? ""}`.trim();
      if (author.family) return author.family;
      return author.name?.trim() ?? "";
    })
    .filter(Boolean)
    .join(", ");
}

function crossrefHit(work: CrossrefWork, source: PaperHit["source"]): PaperHit | undefined {
  const title = stripMarkup(work.title?.[0] ?? "");
  if (!title) return undefined;
  const doi = normalizeDoi(work.DOI);
  const pmid = work["alternative-id"]?.find((value) => /^\d{6,}$/.test(value));
  const journal = work["container-title"]?.[0]?.trim();
  const abstract = work.abstract ? stripMarkup(work.abstract) : undefined;
  const year = crossrefYear(work);
  return {
    id: pmid || doi || crypto.randomUUID(),
    title,
    authors: crossrefAuthors(work.author),
    ...(year ? { year } : {}),
    ...(doi ? { doi } : {}),
    ...(pmid ? { pmid } : {}),
    ...(journal ? { journal } : {}),
    ...(abstract ? { abstract } : {}),
    source,
  };
}

async function searchCrossref(
  query: string,
  pageSize: number,
  filter: string,
  sourceFor: (work: CrossrefWork) => PaperHit["source"],
): Promise<PaperHit[]> {
  const url = new URL(CROSSREF_WORKS);
  url.searchParams.set("query", query);
  url.searchParams.set("rows", String(boundedPageSize(pageSize)));
  url.searchParams.set("filter", filter);
  url.searchParams.set(
    "select",
    "DOI,title,author,abstract,container-title,published-print,published-online,created,alternative-id",
  );
  const data = (await fetchJson(url.toString())) as { message?: { items?: CrossrefWork[] } };
  return (data.message?.items ?? [])
    .map((work) => crossrefHit(work, sourceFor(work)))
    .filter((hit): hit is PaperHit => Boolean(hit));
}

function preprintSource(work: CrossrefWork): PaperHit["source"] {
  const journal = work["container-title"]?.[0]?.toLowerCase() ?? "";
  return journal.includes("medrxiv") ? "medrxiv" : "biorxiv";
}

type OpenAlexIds = { pmid?: string; doi?: string };
type OpenAlexAuthorship = { author?: { display_name?: string } };
type OpenAlexWork = {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  authorships?: OpenAlexAuthorship[];
  primary_location?: { source?: { display_name?: string } };
  ids?: OpenAlexIds;
  abstract_inverted_index?: Record<string, number[]>;
};

export function reconstructOpenAlexAbstract(
  index: Record<string, number[]> | undefined,
): string | undefined {
  if (!index) return undefined;
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0) slots[position] = word;
    }
  }
  const text = slots.filter((word) => word).join(" ").trim();
  return text || undefined;
}

function openAlexPmid(value?: string): string | undefined {
  const digits = value?.match(/(\d{5,})$/)?.[1];
  return digits;
}

function openAlexHit(work: OpenAlexWork): PaperHit | undefined {
  const title = stripMarkup(work.display_name || work.title || "");
  if (!title) return undefined;
  const doi = normalizeDoi(work.doi) || normalizeDoi(work.ids?.doi);
  const pmid = openAlexPmid(work.ids?.pmid);
  const year = work.publication_year == null ? undefined : String(work.publication_year);
  const journal = work.primary_location?.source?.display_name?.trim();
  const authors = (work.authorships ?? [])
    .map((row) => row.author?.display_name?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
  const abstract = reconstructOpenAlexAbstract(work.abstract_inverted_index);
  return {
    id: pmid || doi || work.id || crypto.randomUUID(),
    title,
    authors,
    ...(year ? { year } : {}),
    ...(doi ? { doi } : {}),
    ...(pmid ? { pmid } : {}),
    ...(journal ? { journal } : {}),
    ...(abstract ? { abstract } : {}),
    source: "openalex",
  };
}

async function searchOpenAlex(query: string, pageSize: number): Promise<PaperHit[]> {
  const url = new URL(OPENALEX_WORKS);
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(boundedPageSize(pageSize)));
  url.searchParams.set(
    "select",
    "id,doi,title,display_name,authorships,publication_year,primary_location,ids,abstract_inverted_index",
  );
  const data = (await fetchJson(url.toString())) as { results?: OpenAlexWork[] };
  return (data.results ?? []).map(openAlexHit).filter((hit): hit is PaperHit => Boolean(hit));
}

async function settledSource(
  source: SourceName,
  task: () => Promise<PaperHit[]>,
): Promise<{ source: SourceName; hits: PaperHit[] } | { source: SourceName; error: string }> {
  try {
    return { source, hits: await task() };
  } catch (error) {
    return {
      source,
      error: error instanceof Error ? error.message : `${source} search failed`,
    };
  }
}

export async function searchLiterature(
  query: string,
  pageSize = 5,
): Promise<LiteratureSearchResult> {
  const q = query.trim();
  if (!q) return { query, hits: [], warnings: [] };
  const perSource = boundedPageSize(pageSize);
  const limit = boundedLimit(pageSize);
  const settled = await Promise.all([
    settledSource("europe-pmc", () => searchEuropePmc(q, perSource)),
    settledSource("pubmed", () => searchPubmed(q, perSource)),
    settledSource("biorxiv", () =>
      searchCrossref(q, perSource, "prefix:10.1101,type:posted-content", preprintSource),
    ),
    settledSource("crossref", () =>
      searchCrossref(q, perSource, "type:journal-article", () => "crossref"),
    ),
    settledSource("openalex", () => searchOpenAlex(q, perSource)),
  ]);

  const groups: PaperHit[][] = [];
  const warnings: string[] = [];
  for (const result of settled) {
    if ("error" in result) {
      warnings.push(`${result.source}: ${result.error}`);
      continue;
    }
    groups.push(result.hits);
  }
  if (groups.length === 0) {
    throw new Error(warnings.join("; ") || "literature search failed");
  }
  return {
    query: q,
    hits: mergeUniquePaperHits(groups, limit),
    warnings,
  };
}

export const paperSearchTool: ToolDef = {
  name: "paper_search",
  description:
    "Search Europe PMC, NCBI PubMed, bioRxiv/medRxiv, Crossref, and OpenAlex. Returns deduplicated trusted metadata; no model-generated BibTeX or identifiers.",
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
    const rawSize = Number(args.pageSize ?? 5);
    const pageSize = Number.isFinite(rawSize) ? rawSize : 5;
    try {
      const result = await searchLiterature(query, pageSize);
      return {
        ok: true,
        data: {
          query: result.query,
          count: result.hits.length,
          hits: result.hits,
          warnings: result.warnings,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "paper_search failed",
        code: "SEARCH_FAILED",
      };
    }
  },
};
