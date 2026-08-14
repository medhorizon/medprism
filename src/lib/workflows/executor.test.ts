import { describe, expect, it, vi } from "vitest";
import { detectSkillIntent, routeWorkflow, workflowForIntent } from "../skillRouter";
import { simulatePatchSet } from "../patch/simulate";
import type { ToolContext, ToolResult } from "../../tools/types";
import { executeWorkflow, listWorkflows } from "./executor";
import type { WorkflowKind, WorkflowRequest, WorkflowServices } from "./types";

const config = { mode: "mock" } as const;

function context(args: {
  source?: string;
  activeFile?: string;
  mainFile?: string;
  selection?: { start: number; end: number };
  extraFiles?: Record<string, string>;
  lastCompileLog?: string;
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
    ...(args.lastCompileLog ? { lastCompileLog: args.lastCompileLog } : {}),
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

/** Tests simulate the post-classifier bind; production uses classifyWorkflowKind. */
function simulateClassifiedKind(text: string): WorkflowKind {
  const intent = detectSkillIntent(text);
  if (intent !== "write" && intent !== "nature-writing") {
    return workflowForIntent(intent);
  }
  // Standalone research was never part of detectSkillIntent — keep test parity.
  if (
    /(?:调研|literature\s+search|\bresearch\b)/i.test(text) &&
    !/写|撰写|润色|cite|引用|补引用|完善|准备|修改|更新|生成|draft|write|prepare|revise/i.test(
      text,
    )
  ) {
    return "research";
  }
  if (
    /补充哪些|检查模板|还有[哪那]些.*需要补充|需要准备什么|怎么办|是什么意思/i.test(text)
  ) {
    return "advice";
  }
  return "writing";
}

function requestFor(text: string, args: Partial<WorkflowRequest> = {}): WorkflowRequest {
  const kind = args.kind ?? simulateClassifiedKind(text);
  const route = routeWorkflow({ text, explicitWorkflow: kind });
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

const formulatedQueryResponse = JSON.stringify({
  query: "hepatocellular carcinoma mortality",
  sinceYear: 2021,
});

describe("workflow executor", () => {
  it("registers eight deterministic workflows, including advice and research", () => {
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
        patchProposal: {
          schemaVersion: "1",
          summary: "Revise selected text",
          operations: [{
            op: "replace_text",
            oldText: "Original sentence.",
            newText: "Revised sentence.",
          }],
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
    expect(systemPrompt).toContain("# Scientific Writing");
  });

  it("lets the model distinguish source context from the requested destination", async () => {
    const source = [
      "\\documentclass{article}",
      "\\title{Existing title}",
      "\\begin{document}",
      "\\section{Introduction}",
      "Old introduction.",
      "\\end{document}",
    ].join("\n");
    const ctx = context({ source });
    const result = await executeWorkflow({
      request: requestFor("基于标题写一个引言", {
        activeFile: "main.tex",
        mainFile: "main.tex",
      }),
      config,
      history: [],
      ctx,
    }, services({
      modelResponses: [JSON.stringify({
        schemaVersion: "1",
        workflow: "writing",
        summary: "Write introduction",
        warnings: [],
        content: "An introduction edit is ready.",
        patchProposal: {
          schemaVersion: "1",
          summary: "Write introduction",
          operations: [{
            op: "replace_text",
            oldText: "Old introduction.",
            newText: "New introduction based on the manuscript title.",
          }],
        },
      })],
    }));

    if (!result.agent.patch) throw new Error("Expected an introduction patch");
    const simulated = await simulatePatchSet({ ...ctx.files }, result.agent.patch);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]).toContain("\\title{Existing title}");
      expect(simulated.simulation.nextFiles["main.tex"]).toContain(
        "New introduction based on the manuscript title.",
      );
    }
  });

  it.each([
    ["帮我调研 HCC 并写一个摘要", "abstract", "New abstract text grounded in trusted literature.", "Old abstract."],
    ["调研 HCC 后撰写 Methods", "methods", "New methods prose grounded in trusted literature.", "Old methods."],
    ["调研 HCC 并写 Discussion", "discussion", "New discussion prose grounded in trusted literature.", "Old discussion."],
    ["调研 HCC 并完善 Funding", "funding", "Funding was provided by the institutional research programme.", "Old funding."],
  ] as const)("runs research once, lets the model target %s, and produces a LaTeX patch", async (userText, targetKind, draftedText, oldText) => {
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
      modelResponses: [JSON.stringify({
        schemaVersion: "1",
        workflow: "writing",
        summary: `Write ${targetKind}`,
        warnings: [],
        content: "A scoped edit is ready.",
        researchUse: { sourceCandidateIds: [trustedHit.id] },
        patchProposal: {
          schemaVersion: "1",
          summary: `Write ${targetKind}`,
          operations: [{ op: "replace_text", oldText, newText: draftedText }],
        },
      })],
      onTool: () => events.push("research"),
      onModel: () => events.push("model"),
    }));

    expect(events).toEqual(["research", "model"]);
    expect(result.agent.patch?.verify?.compile).toBe(true);
    expect(result.toolNotes).toContain("workflow:writing");
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
      modelResponses: [JSON.stringify({
        schemaVersion: "1",
        workflow: "writing",
        summary: "Add Limitations",
        warnings: [],
        content: "A Limitations section is ready.",
        researchUse: { sourceCandidateIds: [trustedHit.id] },
        patchProposal: {
          schemaVersion: "1",
          summary: "Add Limitations",
          operations: [{
            op: "insert_before",
            anchor: "\\end{document}",
            text: "\\section{Limitations}\nThe available evidence remains limited by study heterogeneity.\n",
            targetKind: "section",
          }],
        },
      })],
    }));

    expect(result.toolNotes).toContain("workflow:writing");
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
      modelResponses: [JSON.stringify({
        schemaVersion: "1",
        workflow: "polish",
        summary: "Polish selected claim",
        warnings: [],
        content: "A scoped edit is ready.",
        researchUse: { sourceCandidateIds: [trustedHit.id] },
        patchProposal: {
          schemaVersion: "1",
          summary: "Polish selected claim",
          operations: [{
            op: "replace_text",
            oldText: selected,
            newText: "We enrolled a total of 20 patients \\cite{trustedOld}.",
          }],
        },
      })],
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
      modelResponses: [JSON.stringify({
        schemaVersion: "1",
        workflow: "polish",
        summary: "Polish selected claim",
        warnings: [],
        content: "A scoped edit is ready.",
        researchUse: { sourceCandidateIds: [trustedHit.id] },
        patchProposal: {
          schemaVersion: "1",
          summary: "Polish selected claim",
          operations: [{
            op: "replace_text",
            oldText: selected,
            newText: "We enrolled patients.",
          }],
        },
      })],
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
      modelResponses: [formulatedQueryResponse, JSON.stringify({
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

    expect(events).toEqual(["model", "research", "model"]);
    expect(result.toolNotes).toContain("research-query:llm");
    expect(result.agent.patch?.operations).toHaveLength(2);
    expect(result.agent.patch?.operations.map((operation) => operation.op).sort()).toEqual([
      "bib_add",
      "replace_text",
    ]);
    expect(result.agent.patch?.verify?.compile).toBe(true);
  });

  it("searches with the LLM keyword query instead of the selected claim sentence", async () => {
    const claim = "Hepatocellular carcinoma (HCC) is a major cause of cancer-related morbidity and mortality worldwide.";
    const ctx = context({
      source: `${claim}\n\\bibliography{references}\n\\end{document}`,
      selection: { start: 0, end: claim.length },
    });
    const svc = services({
      toolResult: { ok: true, data: { hits: [trustedHit] } },
      modelResponses: [formulatedQueryResponse, JSON.stringify({
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
    });
    await executeWorkflow({
      request: requestFor("为introduction添加引用，要求近5年，至少5篇", {
        kind: "citation",
        selectedText: claim,
        selection: { start: 0, end: claim.length },
      }),
      config,
      history: [],
      ctx,
    }, svc);

    expect(svc.complete).toHaveBeenNthCalledWith(1, expect.objectContaining({ stream: false }));
    expect(svc.runTool).toHaveBeenCalledWith(
      "paper_search",
      expect.objectContaining({ query: "hepatocellular carcinoma mortality" }),
      expect.anything(),
    );
  });

  it("locates a Discussion claim via LLM when citation has no selection", async () => {
    const claim = "Immune activation worsens outcomes.";
    const source = [
      "\\section{Discussion}",
      claim,
      "Further discussion.",
      "\\bibliography{references}",
      "\\end{document}",
    ].join("\n");
    const events: string[] = [];
    const result = await executeWorkflow({
      request: requestFor("帮我给这篇文章的discussion增加引用", {
        kind: "citation",
        activeFile: "main.tex",
      }),
      config,
      history: [],
      ctx: context({ source }),
    }, services({
      toolResult: { ok: true, data: { hits: [trustedHit] } },
      modelResponses: [
        JSON.stringify({
          claimText: claim,
          path: "main.tex",
          reason: "Unsupported claim",
        }),
        formulatedQueryResponse,
        JSON.stringify({
          schemaVersion: "1",
          workflow: "citation",
          summary: "Choose evidence",
          warnings: [],
          citationPlan: {
            candidates: [{
              candidateId: trustedHit.id,
              relation: "supports",
              selected: true,
              reason: "Relevant abstract.",
            }],
          },
        }),
      ],
      onTool: () => events.push("research"),
      onModel: () => events.push("model"),
    }));

    expect(events).toEqual(["model", "model", "research", "model"]);
    expect(result.toolNotes.some((note) => note.startsWith("citation-claim:llm:"))).toBe(true);
    expect(result.toolNotes).toContain("research-query:llm");
    expect(result.agent.patch?.operations.some((operation) => operation.op === "replace_text")).toBe(
      true,
    );
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
    }, services({ modelResponses: ["not json", "still not json"] }));
    expect(result.agent.patch).toBeUndefined();
    expect(result.agent.warnings.length).toBeGreaterThan(0);
    expect(result.toolNotes).toContain("model-result-retried");
  });

  it("retries once when the first writing JSON uses an illegal op", async () => {
    const figure = "\\includegraphics{extra.png}";
    const source = `${figure}\n\\end{document}\n`;
    const svc = services({
      modelResponses: [
        JSON.stringify({
          schemaVersion: "1",
          workflow: "writing",
          summary: "Delete extra figure",
          warnings: [],
          content: "Removing the trailing figure.",
          patchProposal: {
            operations: [{ op: "delete", oldText: figure }],
          },
        }),
        JSON.stringify({
          schemaVersion: "1",
          workflow: "writing",
          summary: "Delete extra figure",
          warnings: [],
          content: "Removing the trailing figure.",
          patchProposal: {
            operations: [{
              op: "replace_text",
              oldText: figure,
              newText: "",
            }],
          },
        }),
      ],
    });
    const result = await executeWorkflow({
      request: requestFor("删除文末多余的图片", { activeFile: "main.tex", mainFile: "main.tex" }),
      config,
      history: [],
      ctx: context({ source }),
    }, svc);

    expect(svc.complete).toHaveBeenCalledTimes(2);
    const retryMessages = vi.mocked(svc.complete).mock.calls[1]![0].messages;
    expect(retryMessages.at(-2)).toMatchObject({ role: "assistant" });
    expect(retryMessages.at(-1)?.content).toContain("<runtime_rejection>");
    expect(retryMessages.at(-1)?.content).toContain("replace_text/insert");
    expect(result.toolNotes).toContain("model-result-retried");
    expect(result.agent.patch?.operations[0]).toMatchObject({
      op: "replace_text",
      oldText: figure,
      newText: "",
    });
  });

  it("retries once when the first citation JSON omits citationPlan", async () => {
    const claim = "This claim needs evidence.";
    const ctx = context({
      source: `${claim}\n\\bibliography{references}\n\\end{document}`,
      selection: { start: 0, end: claim.length },
    });
    const svc = services({
      toolResult: { ok: true, data: { hits: [trustedHit] } },
      modelResponses: [
        formulatedQueryResponse,
        JSON.stringify({
          schemaVersion: "1",
          workflow: "citation",
          summary: "Choose evidence",
          warnings: [],
          content: "Missing plan.",
        }),
        JSON.stringify({
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
        }),
      ],
    });
    const result = await executeWorkflow({
      request: requestFor("给这句话补引用", {
        selectedText: claim,
        selection: { start: 0, end: claim.length },
      }),
      config,
      history: [],
      ctx,
    }, svc);

    expect(svc.complete).toHaveBeenCalledTimes(3);
    const retryMessages = vi.mocked(svc.complete).mock.calls[2]![0].messages;
    expect(retryMessages.at(-2)).toMatchObject({ role: "assistant" });
    expect(retryMessages.at(-1)?.content).toContain("<runtime_rejection>");
    expect(retryMessages.at(-1)?.content).toContain("citationPlan");
    expect(result.toolNotes).toContain("model-result-retried");
    expect(result.agent.patch?.operations.some((operation) => operation.op === "replace_text")).toBe(
      true,
    );
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
      modelResponses: [formulatedQueryResponse, JSON.stringify({
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

  it("compile-fix sends the log and LaTeX to the model instead of requiring a parsed file:line", async () => {
    const ctx = context({
      source: "line1\n\\badcommand\nline3",
      activeFile: "sections/methods.tex",
      extraFiles: { "main.tex": "Main text" },
      lastCompileLog: "! Undefined control sequence\nl.2 \\badcommand",
    });
    const svc = services({
      modelResponses: [JSON.stringify({
        schemaVersion: "1",
        workflow: "compile-fix",
        summary: "Fix command",
        warnings: [],
        patchProposal: {
          operations: [{
            op: "replace_text",
            path: "sections/methods.tex",
            oldText: "\\badcommand",
            newText: "text",
          }],
        },
      })],
    });
    const result = await executeWorkflow({
      request: requestFor("诊断编译警告", { kind: "compile-fix" }),
      config,
      history: [],
      ctx,
    }, svc);

    expect(svc.runTool).not.toHaveBeenCalled();
    const firstCall = vi.mocked(svc.complete).mock.calls[0]![0];
    expect(firstCall.messages.some((message) => message.content.includes("\\badcommand"))).toBe(true);
    expect(firstCall.messages.some((message) => /source="compile"/.test(message.content))).toBe(true);
    expect(result.agent.patch?.operations[0]).toMatchObject({
      op: "replace_text",
      path: "sections/methods.tex",
      oldText: "\\badcommand",
      newText: "text",
    });
  });

  it("compile-fix does not ask the model to repair warning-only logs", async () => {
    const svc = services({ modelResponses: [] });
    const result = await executeWorkflow({
      request: requestFor("诊断编译警告", { kind: "compile-fix" }),
      config,
      history: [],
      ctx: context({ lastCompileLog: "Overfull \\hbox (12.0pt too wide)" }),
    }, svc);
    expect(svc.complete).not.toHaveBeenCalled();
    expect(result.agent.patch).toBeUndefined();
    expect(result.content).toMatch(/警告/);
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
