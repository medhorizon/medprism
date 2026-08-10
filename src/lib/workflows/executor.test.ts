import { describe, expect, it, vi } from "vitest";
import { executeWorkflow, listWorkflows } from "./executor";
import type { ModelCompletionRequest, WorkflowServices } from "./types";
import type { ToolContext, ToolResult } from "../../tools/types";

const config = { mode: "mock" } as const;

function context(args: {
  source?: string;
  activeFile?: string;
  selection?: { start: number; end: number };
  extraFiles?: Record<string, string>;
} = {}): ToolContext {
  const activeFile = args.activeFile ?? "main.tex";
  const source = args.source ?? "Original sentence.";
  return {
    projectId: "project-1",
    files: {
      [activeFile]: source,
      ...(args.extraFiles ?? {}),
    },
    activeFile,
    mainFile: activeFile,
    ...(args.selection ? { selection: args.selection } : {}),
  };
}

function services(args: {
  modelResponses?: string[];
  toolResult?: ToolResult;
  onModel?: (system: string) => void;
} = {}): WorkflowServices {
  const responses = [...(args.modelResponses ?? [])];
  return {
    complete: vi.fn(async ({ messages }: ModelCompletionRequest) => {
      const system =
        messages.find((message: ModelCompletionRequest["messages"][number]) => message.role === "system")
          ?.content ?? "";
      args.onModel?.(system);
      const response = responses.shift();
      if (response === undefined) throw new Error("Unexpected model call");
      return response;
    }),
    runTool: vi.fn(
      async (): Promise<ToolResult> =>
        args.toolResult ?? { ok: false, error: "Unexpected tool call" },
    ),
  };
}

function writingEnvelope(workflow: "writing" | "polish" | "latex" = "writing"): string {
  return JSON.stringify({
    schemaVersion: "1",
    workflow,
    summary: "Revise selected text",
    warnings: [],
    content: "A scoped edit is ready.",
    patchProposal: {
      schemaVersion: "1",
      summary: "Revise selected text",
      operations: [{
        op: "replace_text",
        oldText: "Original sentence.",
        newText: "Revised sentence.",
      }],
    },
  });
}

describe("workflow executor", () => {
  it("registers the six deterministic V1 workflows", () => {
    expect(listWorkflows().sort()).toEqual([
      "citation",
      "compile-fix",
      "latex",
      "polish",
      "review",
      "writing",
    ]);
  });

  it("writing produces a validated PatchSet without writing files directly", async () => {
    const ctx = context({ selection: { start: 0, end: "Original sentence.".length } });
    let systemPrompt = "";
    const result = await executeWorkflow({
      request: {
        kind: "writing",
        userText: "Rewrite without changing the data",
        activeFile: "main.tex",
        selectedText: "Original sentence.",
        selection: { start: 0, end: "Original sentence.".length },
        mainFile: "main.tex",
      },
      config,
      history: [],
      ctx,
    }, services({
      modelResponses: [writingEnvelope()],
      onModel: (system) => { systemPrompt = system; },
    }));

    expect(result.agent.patch?.operations[0]).toMatchObject({
      op: "replace_text",
      path: "main.tex",
      oldText: "Original sentence.",
      newText: "Revised sentence.",
    });
    expect(ctx.files["main.tex"]).toBe("Original sentence.");
    expect((systemPrompt.match(/# Selected skill:/g) ?? [])).toHaveLength(1);
  });

  it("invalid structured writing output never produces a Keep-eligible patch", async () => {
    const result = await executeWorkflow({
      request: { kind: "writing", userText: "rewrite", activeFile: "main.tex" },
      config,
      history: [],
      ctx: context(),
    }, services({ modelResponses: ["not json"] }));
    expect(result.agent.patch).toBeUndefined();
    expect(result.agent.warnings.length).toBeGreaterThan(0);
  });

  it("citation performs search before any model call and stops on zero hits", async () => {
    const claim = "This claim needs evidence.";
    const ctx = context({ source: `${claim}\n\\bibliography{references}\n`, selection: { start: 0, end: claim.length } });
    const mockServices = services({ toolResult: { ok: true, data: { hits: [] } } });
    const result = await executeWorkflow({
      request: {
        kind: "citation",
        userText: "Add a citation",
        activeFile: "main.tex",
        selectedText: claim,
        selection: { start: 0, end: claim.length },
      },
      config,
      history: [],
      ctx,
    }, mockServices);
    expect(mockServices.runTool).toHaveBeenCalledTimes(1);
    expect(mockServices.complete).not.toHaveBeenCalled();
    expect(result.agent.patch).toBeUndefined();
  });

  it("citation calls the search tool before its judgement model", async () => {
    const events: string[] = [];
    const claim = "This claim needs evidence.";
    const ctx = context({
      source: `${claim}\n\\bibliography{references}\n`,
      selection: { start: 0, end: claim.length },
    });
    const hit = {
      id: "trusted-1",
      title: "Trusted paper",
      authors: "Author A",
      abstract: "Evidence relevant to the claim.",
      doi: "10.1000/trusted",
    };
    const modelResponse = JSON.stringify({
      schemaVersion: "1",
      workflow: "citation",
      summary: "Choose evidence",
      warnings: [],
      citationPlan: {
        candidates: [{
          candidateId: "trusted-1",
          relation: "supports",
          selected: true,
          reason: "abstract",
        }],
      },
    });
    const orderedServices: WorkflowServices = {
      runTool: vi.fn(async (): Promise<ToolResult> => {
        events.push("search");
        return { ok: true, data: { hits: [hit] } };
      }),
      complete: vi.fn(async () => {
        events.push("model");
        return modelResponse;
      }),
    };
    await executeWorkflow({
      request: {
        kind: "citation",
        userText: "Add a citation",
        activeFile: "main.tex",
        selectedText: claim,
        selection: { start: 0, end: claim.length },
      },
      config,
      history: [],
      ctx,
    }, orderedServices);
    expect(events).toEqual(["search", "model"]);
  });

  it("combined polish plus citation uses two deterministic model steps with one Skill each", async () => {
    const claim = "This claim needs evidence.";
    const ctx = context({
      source: `${claim}\n\\bibliography{references}\n`,
      selection: { start: 0, end: claim.length },
    });
    const hit = {
      id: "trusted-1",
      title: "Trusted paper",
      authors: "Author A",
      abstract: "Evidence relevant to the claim.",
      doi: "10.1000/trusted",
    };
    const systems: string[] = [];
    const result = await executeWorkflow({
      request: {
        kind: "citation",
        userText: "Polish this claim and add a citation",
        activeFile: "main.tex",
        selectedText: claim,
        selection: { start: 0, end: claim.length },
        reviseProse: true,
      },
      config,
      history: [],
      ctx,
    }, services({
      toolResult: { ok: true, data: { hits: [hit] } },
      modelResponses: [
        JSON.stringify({
          schemaVersion: "1",
          workflow: "citation",
          summary: "Choose evidence",
          warnings: [],
          citationPlan: {
            candidates: [{
              candidateId: "trusted-1",
              relation: "supports",
              selected: true,
              reason: "abstract",
            }],
          },
        }),
        JSON.stringify({
          schemaVersion: "1",
          workflow: "polish",
          summary: "Polish the claim",
          warnings: [],
          patchProposal: {
            schemaVersion: "1",
            summary: "Polish the claim",
            operations: [{
              op: "replace_text",
              oldText: claim,
              newText: "This scientific claim requires supporting evidence.",
            }],
          },
        }),
      ],
      onModel: (system) => systems.push(system),
    }));

    expect(systems).toHaveLength(2);
    expect((systems[0]?.match(/# Selected skill:/g) ?? [])).toHaveLength(1);
    expect((systems[1]?.match(/# Selected skill:/g) ?? [])).toHaveLength(1);
    expect(systems[0]).toContain("nature-citation");
    expect(systems[1]).toContain("nature-polishing");
    expect(result.agent.patch?.operations).toHaveLength(2);
  });

  it("citation rejects identifiers or candidates not supplied by the trusted search tool", async () => {
    const claim = "This claim needs evidence.";
    const ctx = context({
      source: `${claim}\n\\bibliography{references}\n`,
      selection: { start: 0, end: claim.length },
    });
    const hit = {
      id: "trusted-1",
      title: "Trusted paper",
      authors: "Author A",
      abstract: "Evidence relevant to the claim.",
      doi: "10.1000/trusted",
    };
    const response = JSON.stringify({
      schemaVersion: "1",
      workflow: "citation",
      summary: "Choose evidence",
      warnings: [],
      citationPlan: {
        candidates: [{
          candidateId: "trusted-1",
          relation: "supports",
          selected: true,
          reason: "abstract",
          doi: "10.9999/invented",
        }],
      },
    });
    const result = await executeWorkflow({
      request: {
        kind: "citation",
        userText: "Add a citation",
        activeFile: "main.tex",
        selectedText: claim,
        selection: { start: 0, end: claim.length },
      },
      config,
      history: [],
      ctx,
    }, services({
      toolResult: { ok: true, data: { hits: [hit] } },
      modelResponses: [response],
    }));
    expect(result.agent.patch).toBeUndefined();
    expect(result.agent.warnings.join(" ")).toMatch(/must not generate doi/i);
  });

  it("compile-fix binds the proposal to the diagnosed path", async () => {
    const ctx = context({
      source: "line1\n\\badcommand\nline3",
      activeFile: "sections/methods.tex",
      extraFiles: { "main.tex": "Main text" },
    });
    const response = JSON.stringify({
      schemaVersion: "1",
      workflow: "compile-fix",
      summary: "Fix command",
      warnings: [],
      patchProposal: {
        schemaVersion: "1",
        summary: "Wrong target",
        operations: [{
          op: "replace_text",
          path: "main.tex",
          oldText: "Main text",
          newText: "Changed",
        }],
      },
    });
    const result = await executeWorkflow({
      request: { kind: "compile-fix", userText: "Fix compile" },
      config,
      history: [],
      ctx,
    }, services({
      toolResult: {
        ok: true,
        data: {
          compileOk: false,
          log: "sections/methods.tex:2: Undefined control sequence",
        },
      },
      modelResponses: [response],
    }));
    expect(result.agent.patch).toBeUndefined();
    expect(result.agent.warnings.join(" ")).toMatch(/diagnosed file/i);
  });

  it("review returns a typed advisory report and never a patch", async () => {
    const response = JSON.stringify({
      schemaVersion: "1",
      workflow: "review",
      summary: "Limited review",
      warnings: [],
      review: {
        limitations: ["Only one file was supplied."],
        findings: [{
          severity: "major",
          category: "scientific",
          location: { path: "main.tex", text: "Original sentence" },
          issue: "The claim lacks supporting context.",
          whyItMatters: "Readers cannot assess validity.",
          recommendation: "Add the relevant methods and evidence.",
          canApplyAsEdit: false,
        }],
      },
    });
    const result = await executeWorkflow({
      request: { kind: "review", userText: "Review, do not edit" },
      config,
      history: [],
      ctx: context({ extraFiles: { "notes.txt": "Not supplied to the review model" } }),
    }, services({ modelResponses: [response] }));
    expect(result.agent.review?.findings).toHaveLength(1);
    expect(result.agent.review?.coverage.filesRead).toContain("main.tex");
    expect(result.agent.review?.coverage.filesNotRead).toContain("notes.txt");
    expect(result.agent.patch).toBeUndefined();
  });

  it("rejects a review response that attempts to include a patch", async () => {
    const response = JSON.stringify({
      schemaVersion: "1",
      workflow: "review",
      summary: "Unsafe review",
      warnings: [],
      review: { limitations: [], findings: [] },
      patchProposal: {
        schemaVersion: "1",
        summary: "Do not apply",
        operations: [{
          op: "replace_text",
          oldText: "Original sentence.",
          newText: "Changed.",
        }],
      },
    });
    const result = await executeWorkflow({
      request: { kind: "review", userText: "Review" },
      config,
      history: [],
      ctx: context(),
    }, services({ modelResponses: [response] }));
    expect(result.agent.patch).toBeUndefined();
    expect(result.agent.review).toBeUndefined();
  });
});
