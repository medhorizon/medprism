import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { resolveTaskContext } from "../context/resolver";
import { buildManuscriptModel } from "../manuscript/model";
import { simulatePatchSet } from "../patch/simulate";
import { buildConversationArtifacts } from "../conversationArtifacts";
import { runSemanticWriting } from "./semanticWriting";

const springer = String.raw`\documentclass{sn-jnl}
\begin{document}
\title[Short]{Article Title}
\section{Discussion}
Claim.
\section*{Declarations}
\begin{itemize}
\item Funding: Old funding.
\item Data availability: Old data statement.
\end{itemize}
\bibliography{refs}
\end{document}`;

describe("runtime-owned semantic writing", () => {
  it("scaffolds only missing slots inside Springer Declarations", async () => {
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": springer }, mainFile: "main.tex" });
    const model = buildManuscriptModel(snapshot);
    const resolved = resolveTaskContext({
      snapshot,
      model,
      interpreted: {
        spec: {
          schemaVersion: "2",
          action: "scaffold",
          applyMode: "propose-patch",
          contentMode: "blank",
          scope: "targets",
          evidenceMode: "none",
          targets: [
            { slot: "funding", sourceIds: [] },
            { slot: "code-availability", sourceIds: [] },
          ],
        },
        ok: true,
        sources: [],
        source: "llm",
        repaired: false,
      },
    });
    const result = await runSemanticWriting(snapshot, resolved);
    expect(result?.agent.patch).toBeDefined();
    const simulated = await simulatePatchSet({ ...snapshot.files }, result!.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      const next = simulated.simulation.nextFiles["main.tex"]!;
      expect(next.match(/\\item Funding:/g)).toHaveLength(1);
      expect(next).toContain("\\item Code availability:");
      expect(next.indexOf("Code availability")).toBeLessThan(next.indexOf("\\end{itemize}"));
    }
  });

  it("fills multiple declaration bodies from exact message segments", async () => {
    const userText = "Funding was provided by Grant 1.\nData availability: All data are included in this article.";
    const sources = buildConversationArtifacts({ messageId: "u1", role: "user", content: userText });
    const lines = sources.filter((artifact) => artifact.kind === "line");
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": springer }, mainFile: "main.tex" });
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
          targets: [
            { slot: "funding", sourceIds: [lines[0]!.id] },
            { slot: "data-availability", sourceIds: [lines[1]!.id] },
          ],
        },
        ok: true,
        sources,
        source: "llm",
        repaired: false,
      },
    });
    const result = await runSemanticWriting(snapshot, resolved);
    const simulated = await simulatePatchSet({ ...snapshot.files }, result!.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      const next = simulated.simulation.nextFiles["main.tex"]!;
      expect(next).toContain("\\item Funding: Funding was provided by Grant 1.");
      expect(next).toContain("\\item Data availability: All data are included in this article.");
    }
  });

  it("fills shared multi-target prose by runtime content bindings instead of duplicating the blob", async () => {
    const manuscript = springer.replace(
      "\\item Funding: Old funding.",
      "\\item Author contributions: Old contributions.\n\\item Funding: Old funding.",
    );
    const userText = [
      "Author contributions: Y.L. and H.W. performed experiments.",
      "Funding: This work was supported by Grant 1.",
      "Data availability: All data are included in this article.",
    ].join("\n");
    const sources = buildConversationArtifacts({ messageId: "u1", role: "user", content: userText });
    const block = sources.find((artifact) => artifact.kind === "block")!;
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": manuscript }, mainFile: "main.tex" });
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
          targets: [
            { slot: "author-contributions", sourceIds: [block.id] },
            { slot: "funding", sourceIds: [block.id] },
            { slot: "data-availability", sourceIds: [block.id] },
          ],
        },
        ok: true,
        sources,
        source: "llm",
        repaired: false,
      },
    });
    expect(resolved.errors).toEqual([]);
    expect(resolved.targets.map((target) => target.providedText)).toEqual([
      "Y.L. and H.W. performed experiments.",
      "This work was supported by Grant 1.",
      "All data are included in this article.",
    ]);
    const result = await runSemanticWriting(snapshot, resolved);
    const simulated = await simulatePatchSet({ ...snapshot.files }, result!.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      const next = simulated.simulation.nextFiles["main.tex"]!;
      expect(next).toContain("\\item Author contributions: Y.L. and H.W. performed experiments.");
      expect(next).toContain("\\item Funding: This work was supported by Grant 1.");
      expect(next).toContain("\\item Data availability: All data are included in this article.");
      expect(next).not.toContain("Funding: This work was supported by Grant 1.\nData availability");
    }
  });

  it("uses the canonical target when Data availability is duplicated", async () => {
    const duplicated = springer.replace(
      "\\bibliography{refs}",
      "\\section*{Data availability}\nA second statement.\n\\bibliography{refs}",
    );
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": duplicated }, mainFile: "main.tex" });
    const model = buildManuscriptModel(snapshot);
    const resolved = resolveTaskContext({
      snapshot,
      model,
      interpreted: {
        spec: {
          schemaVersion: "2",
          action: "scaffold",
          applyMode: "propose-patch",
          contentMode: "blank",
          scope: "targets",
          evidenceMode: "none",
          targets: [{ slot: "data-availability", sourceIds: [] }],
        },
        ok: true,
        sources: [],
        source: "llm",
        repaired: false,
      },
    });
    expect(resolved.errors).toEqual([]);
    expect(resolved.ambiguities).toEqual([]);
    expect(resolved.warnings.join(" ")).toContain("Multiple active occurrences exist for data-availability");
    expect(resolved.targets[0]?.occurrence?.canonical).toBe(true);
    const result = await runSemanticWriting(snapshot, resolved);
    expect(result?.agent.patch).toBeUndefined();
  });

  it("updates a title's runtime-owned short form together with its full title", async () => {
    const desired = "A Long Runtime-Owned Title for Reliable Natural Language File Transactions in Scientific Writing";
    const sources = buildConversationArtifacts({ messageId: "u-title", role: "user", content: `修改标题为${desired}` });
    const payload = sources.find((artifact) => artifact.kind === "assignment-value")!;
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": springer }, mainFile: "main.tex" });
    const resolved = resolveTaskContext({
      snapshot,
      model: buildManuscriptModel(snapshot),
      interpreted: {
        spec: {
          schemaVersion: "2",
          action: "fill-sections",
          applyMode: "propose-patch",
          contentMode: "provided",
          scope: "targets",
          evidenceMode: "none",
          targets: [{ slot: "title", sourceIds: [payload.id] }],
        },
        ok: true,
        sources,
        source: "llm",
        repaired: false,
      },
    });
    const result = await runSemanticWriting(snapshot, resolved);
    const simulated = await simulatePatchSet({ ...snapshot.files }, result!.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      const next = simulated.simulation.nextFiles["main.tex"]!;
      expect(next).toContain(`]{${desired}}`);
      expect(next).not.toContain("\\title[Short]");
    }
  });

  it.each([
    "templates/official/springer-nature-sn-jnl/sn-article.tex",
    "templates/official/elsevier-elsarticle/elsarticle-template-num.tex",
    "templates/official/acm-acmart/sample-sigconf.tex",
    "templates/official/ieee-journal/bare_conf.tex",
  ])("replaces the single canonical title in %s", async (path) => {
    const original = readFileSync(resolve(path), "utf8");
    const desired = "Runtime-Owned Semantic Transaction Title";
    const sources = buildConversationArtifacts({
      messageId: `title-${path}`,
      role: "user",
      content: `修改标题为${desired}`,
    });
    const payload = sources.find((artifact) => artifact.kind === "assignment-value")!;
    const snapshot = await buildContextSnapshot({
      projectId: path,
      files: { [path]: original },
      mainFile: path,
      activeFile: path,
    });
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
          targets: [{ slot: "title", sourceIds: [payload.id] }],
        },
        ok: true,
        sources,
        source: "llm",
        repaired: false,
      },
    });
    expect(resolved.errors).toEqual([]);
    expect(resolved.targets).toHaveLength(1);
    const result = await runSemanticWriting(snapshot, resolved);
    expect(result?.agent.patch).toBeDefined();
    const simulated = await simulatePatchSet({ ...snapshot.files }, result!.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      const next = simulated.simulation.nextFiles[path]!;
      expect(next).toContain(desired);
      const reparsed = buildManuscriptModel(await buildContextSnapshot({
        projectId: path,
        files: { [path]: next },
        mainFile: path,
        activeFile: path,
      }));
      const titles = reparsed.occurrences.filter((occurrence) => occurrence.ref.slot === "title");
      expect(titles).toHaveLength(1);
      expect(titles[0]?.body).toContain(desired);
    }
  });
});
