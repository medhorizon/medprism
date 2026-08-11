import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "./snapshot";
import { resolveCitationClaims, resolveTaskContext } from "./resolver";
import { buildManuscriptModel } from "../manuscript/model";
import { buildConversationArtifacts } from "../conversationArtifacts";

describe("semantic Context Resolver", () => {
  it("binds a named section to a runtime occurrence", async () => {
    const source = "\\documentclass{article}\n\\begin{document}\n\\section{Discussion}\nClaim.\n\\end{document}";
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": source }, mainFile: "main.tex" });
    const model = buildManuscriptModel(snapshot);
    const interpreted = {
      spec: {
        schemaVersion: "2" as const,
        action: "cite" as const,
        applyMode: "propose-patch" as const,
        contentMode: "none" as const,
        scope: "targets" as const,
        evidenceMode: "literature" as const,
        targets: [{ slot: "discussion" as const, sourceIds: [] }],
      },
      ok: true as const,
      sources: [],
      source: "llm" as const,
      repaired: false,
    };
    const resolved = resolveTaskContext({ snapshot, model, interpreted });
    expect(resolved.errors).toEqual([]);
    expect(resolved.targets[0]?.occurrence?.body).toContain("Claim");
  });

  it("binds exact user segment text without model repetition", async () => {
    const source = "\\documentclass{article}\n\\begin{document}\n\\section*{Funding}\nOld.\n\\end{document}";
    const userText = "Funding This work was supported by Grant 1.";
    const sources = buildConversationArtifacts({ messageId: "u1", role: "user", content: userText });
    const sourceId = sources.find((artifact) => artifact.kind === "line")!.id;
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": source }, mainFile: "main.tex" });
    const model = buildManuscriptModel(snapshot);
    const resolved = resolveTaskContext({
      snapshot,
      model,
      interpreted: {
        spec: {
          schemaVersion: "2",
          action: "fill-sections",
          applyMode: "propose-patch",
          contentMode: "provided",
          scope: "targets",
          evidenceMode: "none",
          targets: [{ slot: "funding", sourceIds: [sourceId] }],
        },
        ok: true,
        sources,
        source: "llm",
        repaired: false,
      },
    });
    expect(resolved.targets[0]?.providedText).toBe(userText);
  });

  it("prefers the most specific trusted artifact when source ranges overlap", async () => {
    const source = "\\documentclass{article}\n\\begin{document}\n\\title{Old}\n\\end{document}";
    const userText = "修改标题为Exact Runtime Text";
    const sources = buildConversationArtifacts({ messageId: "u1", role: "user", content: userText });
    const line = sources.find((artifact) => artifact.kind === "line")!;
    const assignment = sources.find((artifact) => artifact.kind === "assignment-value")!;
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": source }, mainFile: "main.tex" });
    const model = buildManuscriptModel(snapshot);
    const resolved = resolveTaskContext({
      snapshot,
      model,
      interpreted: {
        spec: {
          schemaVersion: "2",
          action: "fill-sections",
          applyMode: "propose-patch",
          contentMode: "provided",
          scope: "targets",
          evidenceMode: "none",
          targets: [{ slot: "title", sourceIds: [line.id, assignment.id] }],
        },
        ok: true,
        sources,
        source: "llm",
        repaired: false,
      },
    });
    expect(resolved.errors).toEqual([]);
    expect(resolved.targets[0]?.providedText).toBe("Exact Runtime Text");
  });

  it("blocks a title transaction bound to multiple distinct candidates", async () => {
    const source = "\\documentclass{article}\n\\begin{document}\n\\title{Old}\n\\end{document}";
    const sources = buildConversationArtifacts({
      messageId: "a1",
      role: "assistant",
      content: "*First Candidate*\n*Second Candidate*",
    });
    const candidates = sources.filter((artifact) => artifact.kind === "emphasis");
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": source }, mainFile: "main.tex" });
    const model = buildManuscriptModel(snapshot);
    const resolved = resolveTaskContext({
      snapshot,
      model,
      interpreted: {
        spec: {
          schemaVersion: "2",
          action: "fill-sections",
          applyMode: "propose-patch",
          contentMode: "provided",
          scope: "targets",
          evidenceMode: "none",
          targets: [{ slot: "title", sourceIds: candidates.map((candidate) => candidate.id) }],
        },
        ok: true,
        sources,
        source: "llm",
        repaired: false,
      },
    });
    expect(resolved.targets).toEqual([]);
    expect(resolved.errors).toContain("The title target resolves to multiple distinct source artifacts.");
  });

  it("blocks a selection-scoped mutation when the UI selection is unavailable", async () => {
    const source = "\\documentclass{article}\n\\begin{document}\nText\n\\end{document}";
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": source }, mainFile: "main.tex" });
    const model = buildManuscriptModel(snapshot);
    const resolved = resolveTaskContext({
      snapshot,
      model,
      interpreted: {
        spec: {
          schemaVersion: "2",
          action: "polish",
          applyMode: "propose-patch",
          contentMode: "none",
          scope: "selection",
          evidenceMode: "none",
          targets: [],
        },
        ok: true,
        sources: [],
        source: "llm",
        repaired: false,
      },
    });
    expect(resolved.errors).toContain("No trusted selection or semantic target is available for this file transaction.");
  });

  it("splits an unselected target section into runtime-owned claim ranges", async () => {
    const source = "\\documentclass{article}\n\\begin{document}\n\\section{Discussion}\nFirst claim needs evidence. Second claim also needs support.\n\\end{document}";
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": source }, mainFile: "main.tex" });
    const model = buildManuscriptModel(snapshot);
    const resolved = resolveTaskContext({
      snapshot,
      model,
      interpreted: {
        spec: {
          schemaVersion: "2",
          action: "cite",
          applyMode: "propose-patch",
          contentMode: "none",
          scope: "targets",
          evidenceMode: "literature",
          targets: [{ slot: "discussion", sourceIds: [] }],
        },
        ok: true,
        sources: [],
        source: "llm",
        repaired: false,
      },
    });
    const claims = resolveCitationClaims(resolved);
    expect(claims.map((claim) => claim.text)).toEqual([
      "First claim needs evidence.",
      "Second claim also needs support.",
    ]);
    expect(source.slice(claims[0]!.range.start, claims[0]!.range.end)).toBe(claims[0]!.text);
  });
});
