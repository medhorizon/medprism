import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "./snapshot";
import { resolveTaskContext } from "./resolver";
import { buildManuscriptModel } from "../manuscript/model";
import { segmentUserMessage } from "../task/segments";

describe("semantic Context Resolver", () => {
  it("binds a named section to a runtime occurrence", async () => {
    const source = "\\documentclass{article}\n\\begin{document}\n\\section{Discussion}\nClaim.\n\\end{document}";
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": source }, mainFile: "main.tex" });
    const model = buildManuscriptModel(snapshot);
    const interpreted = {
      spec: {
        schemaVersion: "1" as const,
        action: "cite" as const,
        applyMode: "propose-patch" as const,
        contentMode: "none" as const,
        scope: "targets" as const,
        evidenceMode: "literature" as const,
        targets: [{ slot: "discussion" as const, messageSegmentIds: [] }],
      },
      segments: [],
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
    const segments = segmentUserMessage(userText);
    const snapshot = await buildContextSnapshot({ projectId: "p", files: { "main.tex": source }, mainFile: "main.tex" });
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
          targets: [{ slot: "funding", messageSegmentIds: [segments[0]!.id] }],
        },
        segments,
        source: "llm",
        repaired: false,
      },
    });
    expect(resolved.targets[0]?.providedText).toBe(userText);
  });
});
