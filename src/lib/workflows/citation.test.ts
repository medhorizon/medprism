import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { simulatePatchSet } from "../patch/simulate";
import { buildCitationPatch, parseCitationJudgements } from "./citation";
import type { PaperHit } from "../../tools/types";

const hits: PaperHit[] = [{
  id: "123",
  title: "A verified clinical study",
  authors: "Singer M, Example A",
  year: "2024",
  doi: "10.1000/example",
  pmid: "123",
  journal: "Journal",
  abstract: "The study reports an association relevant to the claim.",
  source: "europe-pmc",
}];

describe("citation workflow", () => {
  it("builds one atomic bibliography + cite patch from trusted metadata", async () => {
    const claim = "This is the selected claim.";
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: { "main.tex": `${claim}\n\\bibliography{references}\n\\end{document}\n` },
      activeFile: "main.tex",
      selection: { start: 0, end: claim.length },
    });
    const judged = parseCitationJudgements({
      candidates: [{ candidateId: "123", relation: "supports", selected: true, reason: "abstract" }],
    }, hits);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;

    const built = await buildCitationPatch({ snapshot, hits, judgements: judged.judgements });
    expect(built.ok).toBe(true);
    if (!built.ok || !built.patchSet) return;
    expect(built.patchSet.operations).toHaveLength(2);
    const simulated = await simulatePatchSet(snapshot.files, built.patchSet);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    expect(simulated.simulation.nextFiles["main.tex"]).toMatch(/\\cite\{/);
    expect(simulated.simulation.nextFiles["references.bib"]).toContain(
      "doi = {10.1000/example}",
    );
    expect(simulated.simulation.nextFiles["references.bib"]).toContain(
      "author = {Singer M and Example A}",
    );
  });

  it("returns no PatchSet when the verified reference is already cited and present", async () => {
    const claim = "This is known\\cite{Singer2024Verified}.";
    const bib = "@article{Singer2024Verified,\n  title = {A verified clinical study},\n  doi = {10.1000/example}\n}\n";
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: {
        "main.tex": `${claim}\n\\bibliography{references}\n\\end{document}\n`,
        "references.bib": bib,
      },
      activeFile: "main.tex",
      selection: { start: 0, end: claim.length },
    });
    const built = await buildCitationPatch({
      snapshot,
      hits,
      judgements: [{ candidateId: "123", relation: "supports", selected: true, reason: "abstract" }],
    });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.patchSet).toBeUndefined();
  });



  it("deduplicates selected search hits that identify the same paper", async () => {
    const claim = "This claim needs one source.";
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: { "main.tex": `${claim}\n\\bibliography{references}\n\\end{document}\n` },
      activeFile: "main.tex",
      selection: { start: 0, end: claim.length },
    });
    const duplicateHits: PaperHit[] = [
      hits[0]!,
      { ...hits[0]!, id: "duplicate-record", title: `${hits[0]!.title} ` },
    ];
    const built = await buildCitationPatch({
      snapshot,
      hits: duplicateHits,
      judgements: duplicateHits.map((hit) => ({
        candidateId: hit.id,
        relation: "supports" as const,
        selected: true,
        reason: "same verified study",
      })),
    });
    expect(built.ok).toBe(true);
    if (!built.ok || !built.patchSet) return;
    const simulated = await simulatePatchSet(snapshot.files, built.patchSet);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    const bib = simulated.simulation.nextFiles["references.bib"] ?? "";
    expect((bib.match(/@article\{/g) ?? [])).toHaveLength(1);
    const cite = simulated.simulation.nextFiles["main.tex"] ?? "";
    const keys = cite.match(/\\cite\{([^}]+)\}/)?.[1]?.split(",") ?? [];
    expect(keys).toHaveLength(1);
  });

  it("refuses to create an unreferenced bibliography file", async () => {
    const claim = "This claim needs a source.";
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: { "main.tex": `${claim}\n\\end{document}\n` },
      activeFile: "main.tex",
      selection: { start: 0, end: claim.length },
    });
    const built = await buildCitationPatch({
      snapshot,
      hits,
      judgements: [{ candidateId: "123", relation: "supports", selected: true, reason: "abstract" }],
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.code).toBe("BIBLIOGRAPHY_NOT_CONFIGURED");
  });

  it("uses the bibliography path declared by LaTeX", async () => {
    const claim = "This claim needs a source.";
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: {
        "main.tex": `${claim}\n\\addbibresource{bibliography/library.bib}\n\\end{document}\n`,
      },
      activeFile: "main.tex",
      selection: { start: 0, end: claim.length },
    });
    const built = await buildCitationPatch({
      snapshot,
      hits,
      judgements: [{ candidateId: "123", relation: "supports", selected: true, reason: "abstract" }],
    });
    expect(built.ok).toBe(true);
    if (!built.ok || !built.patchSet) return;
    expect(built.patchSet.operations[0]).toMatchObject({
      op: "bib_add",
      path: "bibliography/library.bib",
      mustNotExist: true,
    });
  });

  it("refuses to guess between multiple active bibliography resources", async () => {
    const claim = "This claim needs a source.";
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: {
        "main.tex": `${claim}\n\\bibliography{refs-a,refs-b}\n\\end{document}\n`,
        "refs-a.bib": "",
        "refs-b.bib": "",
      },
      activeFile: "main.tex",
      selection: { start: 0, end: claim.length },
    });
    const built = await buildCitationPatch({
      snapshot,
      hits,
      judgements: [{ candidateId: "123", relation: "supports", selected: true, reason: "abstract" }],
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.code).toBe("BIBLIOGRAPHY_NOT_CONFIGURED");
  });

  it("rejects title-only support and unknown candidate ids", () => {
    const { abstract: _abstract, ...withoutAbstract } = hits[0]!;
    const titleOnly: PaperHit[] = [{ ...withoutAbstract, id: "title-only" }];
    expect(parseCitationJudgements({
      candidates: [{ candidateId: "title-only", relation: "supports", selected: true }],
    }, titleOnly).ok).toBe(false);
    expect(parseCitationJudgements({
      candidates: [{ candidateId: "invented", relation: "supports", selected: true }],
    }, hits).ok).toBe(false);
  });
});
