import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePubmedXml, reconstructOpenAlexAbstract, searchLiterature } from "./paperSearch";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("literature parsers", () => {
  it("reads PubMed XML metadata and abstract", () => {
    const hits = parsePubmedXml(`
      <PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation>
            <PMID>123456</PMID>
            <Article>
              <ArticleTitle>A verified trial</ArticleTitle>
              <Abstract><AbstractText>Patients were observed.</AbstractText></Abstract>
              <AuthorList>
                <Author><LastName>Singer</LastName><Initials>M</Initials></Author>
              </AuthorList>
              <Journal><Title>Lancet</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
              <ELocationID EIdType="doi">10.1000/example</ELocationID>
            </Article>
          </MedlineCitation>
        </PubmedArticle>
      </PubmedArticleSet>
    `);
    expect(hits).toEqual([
      expect.objectContaining({
        id: "123456",
        pmid: "123456",
        doi: "10.1000/example",
        title: "A verified trial",
        authors: "Singer M",
        year: "2024",
        journal: "Lancet",
        abstract: "Patients were observed.",
        source: "pubmed",
      }),
    ]);
  });

  it("rebuilds an OpenAlex inverted abstract", () => {
    expect(
      reconstructOpenAlexAbstract({
        Patients: [0],
        were: [1],
        observed: [2],
      }),
    ).toBe("Patients were observed");
  });
});

describe("searchLiterature", () => {
  it("merges the same DOI across sources and keeps source failures as warnings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("europepmc")) {
          return jsonResponse({
            resultList: {
              result: [{
                pmid: "111",
                doi: "10.1000/example",
                title: "Shared paper",
                authorString: "Singer M",
                pubYear: "2024",
                journalTitle: "Lancet",
                abstractText: "PMC abstract.",
              }],
            },
          });
        }
        if (url.includes("esearch.fcgi")) {
          return jsonResponse({ esearchresult: { idlist: ["111"] } });
        }
        if (url.includes("efetch.fcgi")) {
          return new Response(
            `<PubmedArticle><PMID>111</PMID><ArticleTitle>Shared paper</ArticleTitle></PubmedArticle>`,
            { status: 200 },
          );
        }
        if (url.includes("api.crossref.org") && url.includes("10.1101")) {
          return jsonResponse({ message: { items: [] } });
        }
        if (url.includes("api.crossref.org")) {
          return jsonResponse({
            message: {
              items: [{
                DOI: "10.1000/example",
                title: ["Shared paper"],
                author: [{ family: "Singer", given: "M" }],
                "container-title": ["Lancet"],
                "published-print": { "date-parts": [[2024]] },
              }],
            },
          });
        }
        if (url.includes("api.openalex.org")) {
          return jsonResponse({ error: "api key required" }, 401);
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const result = await searchLiterature("shared paper", 8);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      id: "111",
      doi: "10.1000/example",
      pmid: "111",
      abstract: "PMC abstract.",
    });
    expect(result.warnings).toEqual(["openalex: HTTP 401"]);
  });

  it("fails only when every source fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    await expect(searchLiterature("topic", 5)).rejects.toThrow(/europe-pmc: Europe PMC HTTP 503/);
  });
});
