import { describe, expect, it } from "vitest";
import { mergeUniquePaperHits } from "./paperHits";
import type { PaperHit } from "./types";

function hit(partial: Partial<PaperHit> & Pick<PaperHit, "id" | "title">): PaperHit {
  return {
    authors: "Author A",
    ...partial,
  };
}

describe("mergeUniquePaperHits", () => {
  it("keeps one row when DOI, PMID, or title identify the same work", () => {
    const pmc = hit({
      id: "111",
      title: "Shared clinical finding",
      doi: "10.1000/Example",
      pmid: "111",
      source: "europe-pmc",
    });
    const crossref = hit({
      id: "10.1000/example",
      title: "Shared clinical finding!",
      doi: "https://doi.org/10.1000/example",
      abstract: "Abstract from Crossref.",
      source: "crossref",
    });
    const titled = hit({
      id: "other",
      title: "Shared clinical finding",
      source: "openalex",
    });
    const merged = mergeUniquePaperHits([[pmc], [crossref], [titled]], 10);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.pmid).toBe("111");
    expect(merged[0]?.doi).toBe("10.1000/example");
    expect(merged[0]?.abstract).toBe("Abstract from Crossref.");
    expect(merged[0]?.id).toBe("111");
  });

  it("keeps distinct works and interleaves sources up to the limit", () => {
    const merged = mergeUniquePaperHits(
      [
        [hit({ id: "p1", title: "PMC one", source: "europe-pmc" })],
        [hit({ id: "u1", title: "PubMed one", pmid: "222", source: "pubmed" })],
        [hit({ id: "b1", title: "Preprint one", doi: "10.1101/2024.01.01.123456", source: "biorxiv" })],
      ],
      2,
    );
    expect(merged.map((row) => row.title)).toEqual(["PMC one", "PubMed one"]);
  });
});
