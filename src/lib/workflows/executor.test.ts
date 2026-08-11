import { describe, expect, it, vi } from "vitest";
import { routeWorkflow } from "../skillRouter";
import { simulatePatchSet } from "../patch/simulate";
import { buildContextSnapshot } from "../context/snapshot";
import { resolveTaskContext } from "../context/resolver";
import { buildManuscriptModel } from "../manuscript/model";
import type { ToolContext, ToolResult } from "../../tools/types";
import { executeWorkflow, listWorkflows } from "./executor";
import type { WorkflowRequest, WorkflowServices } from "./types";

const config = { mode: "mock" } as const;

function context(args: {
  source?: string;
  activeFile?: string;
  mainFile?: string;
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
    mainFile: args.mainFile ?? activeFile,
    ...(args.selection ? { selection: args.selection } : {}),
  };
}

function services(args: {
  modelResponses?: string[];
  toolResult?: ToolResult;
  onModel?: (system: string) => void;
  onTool?: (name: string) => void;
} = {}): WorkflowServices {
  const responses = [...(args.modelResponses ?? [])];
  return {
    complete: vi.fn(async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
      const system = messages.find((message: { role: string }) => message.role === "system")?.content ?? "";
      args.onModel?.(system);
      const response = responses.shift();
      if (response === undefined) throw new Error("Unexpected model call");
      return response;
    }),
    runTool: vi.fn(async (name: string): Promise<ToolResult> => {
      args.onTool?.(name);
      return args.toolResult ?? { ok: false, error: "Unexpected tool call" };
    }),
  };
}

function requestFor(text: string, args: Partial<WorkflowRequest> = {}): WorkflowRequest {
  const route = routeWorkflow({ text });
  return {
    kind: route.kind,
    userText: text,
    reviseProse: route.reviseProse,
    plan: route.plan,
    ...args,
  };
}

const trustedHit = {
  id: "trusted-1",
  title: "Trusted HCC review",
  authors: "Author A",
  abstract: "Abstract-level evidence about hepatocellular carcinoma.",
  doi: "10.1000/trusted",
};

function targetedDraft(text: string, workflow: "writing" | "polish" = "writing", format: "plain-text" | "latex-body" = "plain-text") {
  return JSON.stringify({
    schemaVersion: "1",
    workflow,
    summary: "Draft target text",
    warnings: [],
    content: "Target text is ready.",
    textDraft: {
      text,
      format,
      sourceCandidateIds: [trustedHit.id],
    },
  });
}

function unresearchedTargetedDraft(text: string, workflow: "writing" | "polish" = "polish") {
  return JSON.stringify({
    schemaVersion: "1",
    workflow,
    summary: "Draft target text",
    warnings: [],
    content: "Target text is ready.",
    textDraft: {
      text,
      format: "plain-text",
      sourceCandidateIds: [],
    },
  });
}

describe("workflow executor", () => {
  it("registers eight deterministic workflows, including advice and independent research", () => {
    expect(listWorkflows().sort()).toEqual([
      "advice",
      "citation",
      "compile-fix",
      "latex",
      "polish",
      "research",
      "review",
      "writing",
    ]);
  });

  it("writing produces a runtime-hydrated PatchSet without writing files directly", async () => {
    const ctx = context({ selection: { start: 0, end: "Original sentence.".length } });
    let systemPrompt = "";
    const result = await executeWorkflow({
      request: requestFor("重写这段但不要改变数据", {
        activeFile: "main.tex",
        selectedText: "Original sentence.",
        selection: { start: 0, end: "Original sentence.".length },
        mainFile: "main.tex",
      }),
      config,
      history: [],
      ctx,
    }, services({
      modelResponses: [JSON.stringify({
        schemaVersion: "1",
        workflow: "writing",
        summary: "Revise selected text",
        warnings: [],
        content: "A scoped edit is ready.",
        textDraft: {
          text: "Revised sentence.",
          format: "plain-text",
          sourceCandidateIds: [],
        },
      })],
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

  it("drafts a missing ethics slot through the resolved semantic target", async () => {
    const source = "\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\nText.\n\\end{document}";
    const ctx = context({ source });
    const snapshot = await buildContextSnapshot(ctx);
    const resolvedTask = resolveTaskContext({
      snapshot,
      model: buildManuscriptModel(snapshot),
      interpreted: {
        ok: true,
        spec: {
          schemaVersion: "2",
          action: "draft",
          applyMode: "propose-patch",
          contentMode: "generate",
          scope: "targets",
          evidenceMode: "none",
          targets: [{ slot: "ethics", sourceIds: [] }],
        },
        sources: [],
        source: "llm",
        repaired: false,
      },
    });
    const result = await executeWorkflow({
      request: {
        kind: "writing",
        userText: "起草伦理声明",
        resolvedTask,
        plan: { primary: "writing", steps: ["writing", "latex-apply"], applyToLatex: true },
      },
      config,
      history: [],
      ctx,
    }, services({
      modelResponses: [JSON.stringify({
        schemaVersion: "1",
        workflow: "writing",
        summary: "Draft ethics statement",
        warnings: [],
        textDraft: {
          text: "The study was approved by the institutional ethics committee.",
          format: "plain-text",
          sourceCandidateIds: [],
        },
      })],
    }));
    expect(result.agent.patch).toBeDefined();
    const simulated = await simulatePatchSet({ "main.tex": source }, result.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]).toContain(
        "\\section*{Ethics approval and consent to participate}",
      );
    }
  });

  it("polishes an unselected manuscript as one atomic multi-target PatchSet", async () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Introduction}", "Old introduction prose.",
      "\\section{Methods}", "Old methods prose.",
      "\\section{Results}", "Old results prose.",
      "\\section{Discussion}", "Old discussion prose.",
      "\\section{Conclusion}", "Old conclusion prose.",
      "\\end{document}",
    ].join("\n");
    const ctx = context({ source });
    const snapshot = await buildContextSnapshot(ctx);
    const resolvedTask = resolveTaskContext({
      snapshot,
      model: buildManuscriptModel(snapshot),
      interpreted: {
        ok: true,
        spec: {
          schemaVersion: "2",
          action: "polish",
          applyMode: "propose-patch",
          contentMode: "generate",
          scope: "manuscript",
          evidenceMode: "none",
          targets: [],
        },
        sources: [],
        source: "runtime",
        repaired: true,
      },
    });
    const replacements = [
      "Revised introduction prose.",
      "Revised methods prose.",
      "Revised results prose.",
      "Revised discussion prose.",
      "Revised conclusion prose.",
    ];
    const result = await executeWorkflow({
      request: {
        kind: "polish",
        userText: "润色文章",
        resolvedTask,
        plan: { primary: "polish", steps: ["polish", "latex-apply"], applyToLatex: true },
      },
      config,
      history: [],
      ctx,
    }, services({ modelResponses: replacements.map((text) => unresearchedTargetedDraft(text)) }));

    expect(result.agent.patch?.operations).toHaveLength(5);
    expect(result.agent.patch?.verify?.compile).toBe(true);
    const simulated = await simulatePatchSet({ "main.tex": source }, result.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      for (const replacement of replacements) {
        expect(simulated.simulation.nextFiles["main.tex"]).toContain(replacement);
      }
    }
  });

  it.each([
    ["帮我调研 HCC 并写一个摘要", "abstract", "New abstract text grounded in trusted literature."],
    ["调研 HCC 后撰写 Methods", "methods", "New methods prose grounded in trusted literature."],
    ["调研 HCC 并写 Discussion", "discussion", "New discussion prose grounded in trusted literature."],
    ["调研 HCC 并完善 Funding", "funding", "Funding was provided by the institutional research programme."],
  ] as const)("runs research once, writes %s, and produces a LaTeX patch", async (userText, targetKind, draftedText) => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\begin{abstract}",
      "Old abstract.",
      "\\end{abstract}",
      "\\section{Methods}",
      "Old methods.",
      "\\section{Discussion}",
      "Old discussion.",
      "\\section*{Funding}",
      "Old funding.",
      "\\end{document}",
    ].join("\n");
    const ctx = context({ source });
    const events: string[] = [];
    const result = await executeWorkflow({
      request: requestFor(userText, { activeFile: "main.tex", mainFile: "main.tex" }),
      config,
      history: [],
      ctx,
    }, services({
      toolResult: { ok: true, data: { query: "HCC", hits: [trustedHit] } },
      modelResponses: [targetedDraft(draftedText)],
      onTool: () => events.push("research"),
      onModel: () => events.push("model"),
    }));

    expect(events).toEqual(["research", "model"]);
    expect(result.agent.patch?.verify?.compile).toBe(true);
    expect(result.toolNotes).toContain(`latex-target:${targetKind}:main.tex`);
    if (!result.agent.patch) throw new Error("Expected a LaTeX patch");
    const simulated = await simulatePatchSet({ ...ctx.files }, result.agent.patch);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]).toContain(draftedText);
    }
  });

  it("composes research plus writing into a custom LaTeX section", async () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "Existing body.",
      "\\end{document}",
    ].join("\n");
    const ctx = context({ source });
    const result = await executeWorkflow({
      request: requestFor("调研 HCC 并撰写 Limitations section", {
        activeFile: "main.tex",
        mainFile: "main.tex",
      }),
      config,
      history: [],
      ctx,
    }, services({
      toolResult: { ok: true, data: { hits: [trustedHit] } },
      modelResponses: [targetedDraft("The available evidence remains limited by study heterogeneity.")],
    }));

    expect(result.toolNotes).toContain("latex-target:section:main.tex");
    if (!result.agent.patch) throw new Error("Expected a custom-section patch");
    const simulated = await simulatePatchSet({ ...ctx.files }, result.agent.patch);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]).toContain("\\section{Limitations}");
      expect(simulated.simulation.nextFiles["main.tex"]).toContain("study heterogeneity");
    }
  });

  it("composes research plus polish and preserves protected LaTeX/numerical content", async () => {
    const selected = "We enrolled 20 patients \\cite{trustedOld}.";
    const source = `${selected}\n\\end{document}`;
    const ctx = context({ source, selection: { start: 0, end: selected.length } });
    const result = await executeWorkflow({
      request: requestFor("调研 HCC 后润色这段", {
        activeFile: "main.tex",
        selectedText: selected,
        selection: { start: 0, end: selected.length },
      }),
      config,
      history: [],
      ctx,
    }, services({
      toolResult: { ok: true, data: { hits: [trustedHit] } },
      modelResponses: [targetedDraft(
        "We enrolled a total of 20 patients \\cite{trustedOld}.",
        "polish",
        "latex-body",
      )],
    }));

    expect(result.agent.patch?.operations[0]).toMatchObject({
      path: "main.tex",
      oldText: selected,
      newText: "We enrolled a total of 20 patients \\cite{trustedOld}.",
    });
  });

  it("rejects a research-plus-polish draft that drops protected numbers or citations", async () => {
    const selected = "We enrolled 20 patients \\cite{trustedOld}.";
    const ctx = context({
      source: `${selected}\n\\end{document}`,
      selection: { start: 0, end: selected.length },
    });
    const result = await executeWorkflow({
      request: requestFor("调研 HCC 后润色这段", {
        selectedText: selected,
        selection: { start: 0, end: selected.length },
      }),
      config,
      history: [],
      ctx,
    }, services({
      toolResult: { ok: true, data: { hits: [trustedHit] } },
      modelResponses: [targetedDraft("We enrolled patients.", "polish")],
    }));

    expect(result.agent.patch).toBeUndefined();
    expect(result.agent.warnings.join(" ")).toMatch(/preserve/i);
  });

  it("composes research plus citation with exactly one search and an atomic bib/text patch", async () => {
    const claim = "This claim needs evidence.";
    const ctx = context({
      source: `${claim}\n\\bibliography{references}\n\\end{document}`,
      selection: { start: 0, end: claim.length },
    });
    const events: string[] = [];
    const result = await executeWorkflow({
      request: requestFor("调研 HCC 并给这句话补引用", {
        activeFile: "main.tex",
        selectedText: claim,
        selection: { start: 0, end: claim.length },
      }),
      config,
      history: [],
      ctx,
    }, services({
      toolResult: { ok: true, data: { hits: [trustedHit] } },
      modelResponses: [JSON.stringify({
        schemaVersion: "1",
        workflow: "citation",
        summary: "Choose evidence",
        warnings: [],
        citationPlan: {
          candidates: [{
            candidateId: trustedHit.id,
            relation: "supports",
            selected: true,
            reason: "The abstract is relevant.",
          }],
        },
      })],
      onTool: () => events.push("research"),
      onModel: () => events.push("model"),
    }));

    expect(events).toEqual(["research", "model"]);
    expect(result.agent.patch?.operations).toHaveLength(2);
    expect(result.agent.patch?.operations.map((operation) => operation.op).sort()).toEqual([
      "bib_add",
      "replace_text",
    ]);
    expect(result.agent.patch?.verify?.compile).toBe(true);
  });

  it("standalone research returns an advisory report and never a PatchSet", async () => {
    const result = await executeWorkflow({
      request: requestFor("调研 HCC"),
      config,
      history: [],
      ctx: context(),
    }, services({
      toolResult: { ok: true, data: { hits: [trustedHit] } },
      modelResponses: [JSON.stringify({
        schemaVersion: "1",
        workflow: "research",
        summary: "HCC research summary",
        warnings: [],
        content: "Trusted evidence synthesis.",
      })],
    }));

    expect(result.agent.research?.candidates).toHaveLength(1);
    expect(result.agent.patch).toBeUndefined();
  });

  it("invalid structured output never produces a Keep-eligible patch", async () => {
    const result = await executeWorkflow({
      request: requestFor("rewrite", { activeFile: "main.tex" }),
      config,
      history: [],
      ctx: context(),
    }, services({ modelResponses: ["not json"] }));
    expect(result.agent.patch).toBeUndefined();
    expect(result.agent.warnings.length).toBeGreaterThan(0);
  });

  it("citation rejects identifiers generated outside trusted search results", async () => {
    const claim = "This claim needs evidence.";
    const ctx = context({
      source: `${claim}\n\\bibliography{references}\n\\end{document}`,
      selection: { start: 0, end: claim.length },
    });
    const result = await executeWorkflow({
      request: requestFor("给这句话补引用", {
        selectedText: claim,
        selection: { start: 0, end: claim.length },
      }),
      config,
      history: [],
      ctx,
    }, services({
      toolResult: { ok: true, data: { hits: [trustedHit] } },
      modelResponses: [JSON.stringify({
        schemaVersion: "1",
        workflow: "citation",
        summary: "Choose evidence",
        warnings: [],
        citationPlan: {
          candidates: [{
            candidateId: trustedHit.id,
            relation: "supports",
            selected: true,
            reason: "abstract",
            doi: "10.9999/invented",
          }],
        },
      })],
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
    const result = await executeWorkflow({
      request: requestFor("修复这个 LaTeX 编译错误"),
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
      modelResponses: [JSON.stringify({
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
      })],
    }));
    expect(result.agent.patch).toBeUndefined();
    expect(result.agent.warnings.join(" ")).toMatch(/diagnosed file/i);
  });

  it("review returns a typed advisory report and never a patch", async () => {
    const result = await executeWorkflow({
      request: requestFor("审稿，不要修改"),
      config,
      history: [],
      ctx: context({ extraFiles: { "notes.txt": "Not supplied" } }),
    }, services({ modelResponses: [JSON.stringify({
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
          recommendation: "Add methods and evidence.",
          canApplyAsEdit: false,
        }],
      },
    })] }));
    expect(result.agent.review?.findings).toHaveLength(1);
    expect(result.agent.patch).toBeUndefined();
  });
});
