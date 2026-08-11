import { describe, expect, it, vi } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { resolveTaskContext } from "../context/resolver";
import { buildManuscriptModel } from "../manuscript/model";
import { runAdviceWorkflow } from "./advice";
import type { ModelCompletionRequest } from "./types";

describe("semantic advice workflow", () => {
  it("streams plain advice from resolved context and can never produce a PatchSet", async () => {
    const source = "\\documentclass{article}\n\\begin{document}\n\\section{Discussion}\nThe association was observational.\n\\end{document}";
    const ctx = { projectId: "p", files: { "main.tex": source }, mainFile: "main.tex" };
    const snapshot = await buildContextSnapshot(ctx);
    const model = buildManuscriptModel(snapshot);
    const resolved = resolveTaskContext({
      snapshot,
      model,
      interpreted: {
        spec: {
          schemaVersion: "2",
          action: "advice",
          applyMode: "answer-only",
          contentMode: "none",
          scope: "manuscript",
          evidenceMode: "none",
          targets: [],
        },
        ok: true,
        sources: [],
        source: "llm",
        repaired: false,
      },
    });
    const complete = vi.fn(async (_request: ModelCompletionRequest) =>
      "The wording should remain associative rather than causal.");
    const result = await runAdviceWorkflow({
      request: {
        kind: "advice",
        userText: "Check the scientific logic but do not modify the manuscript.",
        resolvedTask: resolved,
      },
      config: { mode: "mock" },
      history: [],
      ctx,
      services: {
        complete,
        runTool: vi.fn(async () => ({ ok: false as const, error: "unexpected" })),
      },
    });
    expect(result.content).toContain("associative");
    expect(result.agent.patch).toBeUndefined();
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[0]?.stream).not.toBe(false);
  });

  it("adds a deterministic time-sensitivity warning for current journal policy advice", async () => {
    const source = "\\documentclass{article}\n\\begin{document}\nText.\n\\end{document}";
    const ctx = { projectId: "p", files: { "main.tex": source }, mainFile: "main.tex" };
    const snapshot = await buildContextSnapshot(ctx);
    const model = buildManuscriptModel(snapshot);
    const resolved = resolveTaskContext({
      snapshot,
      model,
      interpreted: {
        spec: { schemaVersion: "2", action: "advice", applyMode: "answer-only", contentMode: "none", scope: "active-file", evidenceMode: "none", targets: [] },
        ok: true,
        sources: [],
        source: "llm",
        repaired: false,
      },
    });
    const result = await runAdviceWorkflow({
      request: { kind: "advice", userText: "What are the latest journal submission requirements?", resolvedTask: resolved },
      config: { mode: "mock" },
      history: [],
      ctx,
      services: {
        complete: vi.fn(async () => "Prepare the standard manuscript files."),
        runTool: vi.fn(async () => ({ ok: false as const, error: "unexpected" })),
      },
    });
    expect(result.content).toContain("no official journal guideline source was retrieved");
    expect(result.toolNotes).toContain("advice:current-policy-unverified");
  });
});
