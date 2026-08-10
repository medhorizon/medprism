import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { resolveTaskContext } from "../context/resolver";
import { buildManuscriptModel } from "../manuscript/model";
import { simulatePatchSet } from "../patch/simulate";
import { segmentUserMessage } from "../task/segments";
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
          schemaVersion: "1",
          action: "scaffold",
          applyMode: "propose-patch",
          contentMode: "blank",
          scope: "targets",
          evidenceMode: "none",
          targets: [
            { slot: "funding", messageSegmentIds: [] },
            { slot: "code-availability", messageSegmentIds: [] },
          ],
        },
        segments: [],
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
    const userText = "Funding: Supported by Grant 1.\nData availability: All data are included in this article.";
    const segments = segmentUserMessage(userText);
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": springer }, mainFile: "main.tex" });
    const model = buildManuscriptModel(snapshot);
    const resolved = resolveTaskContext({
      snapshot,
      model,
      interpreted: {
        spec: {
          schemaVersion: "1",
          action: "fill-sections",
          applyMode: "propose-patch",
          contentMode: "provided",
          scope: "targets",
          evidenceMode: "none",
          targets: [
            { slot: "funding", messageSegmentIds: [segments[0]!.id] },
            { slot: "data-availability", messageSegmentIds: [segments[1]!.id] },
          ],
        },
        segments,
        source: "llm",
        repaired: false,
      },
    });
    const result = await runSemanticWriting(snapshot, resolved);
    const simulated = await simulatePatchSet({ ...snapshot.files }, result!.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      const next = simulated.simulation.nextFiles["main.tex"]!;
      expect(next).toContain("\\item Funding: Supported by Grant 1.");
      expect(next).toContain("\\item Data availability: All data are included in this article.");
    }
  });
});
