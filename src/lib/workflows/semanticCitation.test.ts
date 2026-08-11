import { describe, expect, it, vi } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import {
  resolveCitationClaims,
  resolveTaskContext,
} from "../context/resolver";
import { buildManuscriptModel } from "../manuscript/model";
import { simulatePatchSet } from "../patch/simulate";
import type { ToolContext } from "../../tools/types";
import type { WorkflowExecutionInput, WorkflowServices } from "./types";
import { runSemanticCitation } from "./semanticCitation";

function semanticCitationContext(source: string) {
  const ctx: ToolContext = {
    projectId: "project-1",
    files: { "main.tex": source },
    mainFile: "main.tex",
    activeFile: "main.tex",
  };
  return ctx;
}

async function resolvedCitation(ctx: ToolContext) {
  const snapshot = await buildContextSnapshot(ctx);
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
  return { snapshot, resolved, claims: resolveCitationClaims(resolved) };
}

function executionInput(
  ctx: ToolContext,
  resolved: Awaited<ReturnType<typeof resolvedCitation>>["resolved"],
  services: WorkflowServices,
): WorkflowExecutionInput {
  return {
    request: {
      kind: "citation",
      userText: "Add references to the Discussion section.",
      resolvedTask: resolved,
    },
    config: { mode: "mock" },
    history: [],
    ctx,
    services,
  };
}

describe("semantic citation claim workflow", () => {
  it("covers a whole section, limits paper_search concurrency to three, and builds one atomic body replacement", async () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Discussion}",
      "The intervention improved recovery in adults.",
      "The observed benefit was larger in severe disease.",
      "Prior studies report substantial between-study heterogeneity.",
      "These findings may affect future clinical guidance.",
      "\\bibliography{references}",
      "\\end{document}",
    ].join("\n");
    const ctx = semanticCitationContext(source);
    const { snapshot, resolved, claims } = await resolvedCitation(ctx);
    expect(claims).toHaveLength(4);

    let activeSearches = 0;
    let maximumSearches = 0;
    const runTool = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      activeSearches += 1;
      maximumSearches = Math.max(maximumSearches, activeSearches);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeSearches -= 1;
      const query = String(args.query);
      return {
        ok: true as const,
        data: {
          query,
          hits: [{
            id: `paper-${query}`,
            title: `Verified study for ${query}`,
            authors: "Author A",
            year: "2024",
            doi: `10.1234/${query}`,
            abstract: "Abstract-level evidence directly supports the manuscript claim.",
            source: "verified-test-source",
          }],
        },
      };
    });
    const complete = vi.fn(async ({ messages }: Parameters<WorkflowServices["complete"]>[0]) => {
      const system = messages[0]?.content ?? "";
      const payload = JSON.parse(messages[1]?.content ?? "{}") as {
        candidates?: Array<{ claimId?: string; id?: string }>;
      };
      if (system.includes("citation-claim selector")) {
        return JSON.stringify({
          claims: claims.map((claim, index) => ({
            claimId: claim.id,
            searchQuery: `query-${index}`,
          })),
        });
      }
      const candidateId = (payload.candidates?.[0] as { id?: string } | undefined)?.id;
      return JSON.stringify({
        candidates: [{
          candidateId,
          relation: "supports",
          selected: true,
          reason: "The trusted abstract directly supports the claim.",
        }],
      });
    });
    const services: WorkflowServices = { complete, runTool };
    const result = await runSemanticCitation(
      executionInput(ctx, resolved, services),
      snapshot,
      resolved,
    );

    expect(maximumSearches).toBe(3);
    expect(runTool).toHaveBeenCalledTimes(4);
    expect(result.agent.patch).toBeDefined();
    expect(result.agent.patch?.operations.filter((operation) => operation.op === "replace_text")).toHaveLength(1);
    expect(result.agent.patch?.operations.filter((operation) => operation.op === "bib_add")).toHaveLength(1);
    const simulated = await simulatePatchSet({ ...snapshot.files }, result.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]?.match(/\\cite\{/g)).toHaveLength(4);
      expect(simulated.simulation.nextFiles["references.bib"]?.match(/@article\{/g)).toHaveLength(4);
    }
    expect(result.toolNotes).toContain("citation:research-calls:4");
  });

  it("leaves claims unchanged and returns no Keep patch when search has no trusted result", async () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Discussion}",
      "This treatment may substantially improve patient recovery.",
      "\\bibliography{references}",
      "\\end{document}",
    ].join("\n");
    const ctx = semanticCitationContext(source);
    const { snapshot, resolved, claims } = await resolvedCitation(ctx);
    const services: WorkflowServices = {
      complete: vi.fn(async () => JSON.stringify({
        claims: [{ claimId: claims[0]!.id, searchQuery: "treatment patient recovery" }],
      })),
      runTool: vi.fn(async () => ({ ok: true as const, data: { hits: [] } })),
    };
    const result = await runSemanticCitation(
      executionInput(ctx, resolved, services),
      snapshot,
      resolved,
    );
    expect(result.agent.patch).toBeUndefined();
    expect(result.agent.warnings.join(" ")).toContain("No trusted literature support");
  });
});
