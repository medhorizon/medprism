import { describe, expect, it } from "vitest";
import type { PaperHit } from "../../tools/types";
import { parseWritingDraft } from "./abstractWriting";

const trustedHit: PaperHit = {
  id: "paper-1",
  title: "Trusted HCC review",
  authors: "Author A",
  abstract: "Abstract-level evidence about hepatocellular carcinoma.",
};

describe("research-assisted writing draft validation", () => {
  it("accepts plain prose grounded in trusted abstract-level evidence", () => {
    const parsed = parseWritingDraft({
      kind: "abstract",
      text: "Hepatocellular carcinoma is a major primary liver malignancy.",
      sourceCandidateIds: ["paper-1"],
    }, [trustedHit], true);
    expect(parsed.ok).toBe(true);
  });

  it("rejects model-owned citations and bibliographic identifiers inside the abstract", () => {
    const citation = parseWritingDraft({
      kind: "abstract",
      text: "HCC is clinically important \\cite{paper-1}.",
      sourceCandidateIds: ["paper-1"],
    }, [trustedHit], true);
    expect(citation.ok).toBe(false);

    const doi = parseWritingDraft({
      kind: "abstract",
      text: "This summary is based on DOI 10.1000/example.",
      sourceCandidateIds: ["paper-1"],
    }, [trustedHit], true);
    expect(doi.ok).toBe(false);

    const pmid = parseWritingDraft({
      kind: "abstract",
      text: "This summary uses PMID: 12345678.",
      sourceCandidateIds: ["paper-1"],
    }, [trustedHit], true);
    expect(pmid.ok).toBe(false);
  });

  it("requires every research source to come from a trusted hit with an abstract", () => {
    const untrusted = parseWritingDraft({
      kind: "abstract",
      text: "A concise abstract.",
      sourceCandidateIds: ["invented"],
    }, [trustedHit], true);
    expect(untrusted.ok).toBe(false);

    const titleOnly = parseWritingDraft({
      kind: "abstract",
      text: "A concise abstract.",
      sourceCandidateIds: ["title-only"],
    }, [{ id: "title-only", title: "Title only", authors: "Author B" }], true);
    expect(titleOnly.ok).toBe(false);
  });
});
