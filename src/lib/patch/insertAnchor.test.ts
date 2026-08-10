import { describe, expect, it } from "vitest";
import { inferLatexTargetKindFromDraft } from "../latex/textTargets";
import { hydratePatchProposal } from "./hydrate";
import {
  resolveInsertPlacement,
  softenRawPatchProposal,
} from "./insertAnchor";
import { parseModelPatchProposal } from "./schema";

const SPRINGER_LIKE = `\\documentclass{sn-jnl}
\\begin{document}
\\title{Demo}
\\maketitle
\\section{Introduction}
Intro text.
\\section{Methods}
Methods text.
\\section{Results}
Results text.
\\bibliography{sn-bibliography}
\\end{document}
`;

describe("semantic insert placement", () => {
  it("infers declaration kinds from draft headings", () => {
    expect(
      inferLatexTargetKindFromDraft("\\section*{Competing interests}\n\n"),
    ).toBe("conflict-of-interest");
    expect(inferLatexTargetKindFromDraft("\\section*{Funding}\n\n")).toBe("funding");
    expect(inferLatexTargetKindFromDraft("\\section{Discussion}\n\n")).toBe("discussion");
  });

  it("places discussion before bibliography, not at end{document}", () => {
    const placement = resolveInsertPlacement({
      source: SPRINGER_LIKE,
      text: "\\section{Discussion}\n\n",
      targetKind: "discussion",
    });
    expect(placement).toMatchObject({
      via: "semantic-target",
      op: "insert_before",
    });
    expect(placement?.anchor).toMatch(/\\bibliography/);
  });

  it("places competing interests before bibliography via inference", () => {
    const placement = resolveInsertPlacement({
      source: SPRINGER_LIKE,
      text: "\\section*{Competing interests}\n\n",
    });
    expect(placement?.via).toBe("semantic-target");
    expect(placement?.anchor).toMatch(/\\bibliography/);
  });

  it("hydrates a targetKind insert to the semantic anchor", async () => {
    const parsed = parseModelPatchProposal(
      softenRawPatchProposal({
        schemaVersion: "1",
        summary: "Add funding",
        operations: [
          {
            op: "insert_before",
            targetKind: "funding",
            text: "\\section*{Funding}\n\n",
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const hydrated = await hydratePatchProposal(parsed.proposal, {
      projectId: "p",
      projectRevision: "a".repeat(64),
      files: { "sn-article.tex": SPRINGER_LIKE },
      activeFile: "sn-article.tex",
      activeFileSha256: "b".repeat(64),
      localContext: SPRINGER_LIKE,
      mainFile: "sn-article.tex",
    });
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;
    expect(hydrated.patchSet.operations[0]?.op).toBe("insert_before");
    expect(String(hydrated.patchSet.operations[0] && "anchor" in hydrated.patchSet.operations[0]
      ? hydrated.patchSet.operations[0].anchor
      : "")).toMatch(/\\bibliography/);
  });

  it("softens null anchors before parsing", () => {
    const softened = softenRawPatchProposal({
      schemaVersion: "1",
      summary: "Add blanks",
      operations: [
        {
          op: "insert_before",
          anchor: null,
          text: "\\section*{Declarations}\n\n",
        },
      ],
    });
    const parsed = parseModelPatchProposal(softened);
    expect(parsed.ok).toBe(true);
  });

  it("coerces add/create ops and targetKind-only modules into inserts", () => {
    const softened = softenRawPatchProposal({
      schemaVersion: "1",
      summary: "Scaffold Scientific Reports modules",
      operations: [
        { op: "add", targetKind: "funding", content: "" },
        { op: "create", kind: "conflict-of-interest" },
        { op: "append", latex: "\\section*{Consent for publication}\n\n" },
        "\\section*{Code availability}\n\n",
      ],
    });
    const parsed = parseModelPatchProposal(softened);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.proposal.operations).toHaveLength(4);
    expect(parsed.proposal.operations.every((op) => op.op === "insert_before")).toBe(
      true,
    );
    expect(parsed.proposal.operations[0]).toMatchObject({
      targetKind: "funding",
      text: "\\section*{Funding}\n\n",
    });
    expect(parsed.proposal.operations[1]).toMatchObject({
      targetKind: "conflict-of-interest",
    });
  });
});
