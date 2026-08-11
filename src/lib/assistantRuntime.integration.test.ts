import { describe, expect, it } from "vitest";
import { runAssistant } from "./assistantRuntime";
import { buildConversationArtifacts, withConversationArtifacts } from "./conversationArtifacts";
import { sha256Hex } from "./patch/hash";
import { simulatePatchSet } from "./patch/simulate";
import type { InterpretedTask } from "./task/types";
import type { ChatMessage } from "../types/chat";

const source = String.raw`\documentclass{article}
\begin{document}
\title{Old Title}
\maketitle
\section{Introduction}
Text.
\end{document}`;

function request(
  userText: string,
  conversation: ChatMessage[],
  files: Record<string, string> = { "main.tex": source },
  mainFile = "main.tex",
  activeFile = mainFile,
) {
  return {
    mode: "assistant" as const,
    config: { mode: "mock" as const },
    userText,
    history: conversation.slice(0, -1).map(({ role, content }) => ({ role, content })),
    conversation,
    workflow: "auto" as const,
    ctx: {
      projectId: "p",
      files,
      mainFile,
      activeFile,
    },
  };
}

function exactTitleTask(sources: ReturnType<typeof buildConversationArtifacts>, sourceId: string): InterpretedTask {
  return {
    ok: true,
    spec: {
      schemaVersion: "2",
      action: "fill-sections",
      applyMode: "propose-patch",
      contentMode: "provided",
      scope: "targets",
      evidenceMode: "none",
      targets: [{ slot: "title", sourceIds: [sourceId] }],
    },
    sources,
    source: "llm",
    repaired: false,
  };
}

async function oneReplacePatch(files: Record<string, string>, path: string, oldText: string, newText: string) {
  return {
    schemaVersion: "1" as const,
    id: crypto.randomUUID(),
    projectRevision: "r1",
    summary: `Replace ${path}`,
    operations: [{
      op: "replace_text" as const,
      path,
      baseSha256: await sha256Hex(files[path] ?? ""),
      oldText,
      newText,
      expectedOccurrences: 1 as const,
      range: {
        start: (files[path] ?? "").indexOf(oldText),
        end: (files[path] ?? "").indexOf(oldText) + oldText.length,
      },
    }],
    verify: { compile: true },
  };
}

async function multiReplacePatch(
  files: Record<string, string>,
  replacements: Array<{ path: string; oldText: string; newText: string }>,
) {
  return {
    schemaVersion: "1" as const,
    id: crypto.randomUUID(),
    projectRevision: "r1",
    summary: "Fill manuscript sections",
    operations: await Promise.all(replacements.map(async ({ path, oldText, newText }) => ({
      op: "replace_text" as const,
      path,
      baseSha256: await sha256Hex(files[path] ?? ""),
      oldText,
      newText,
      expectedOccurrences: 1 as const,
      range: {
        start: (files[path] ?? "").indexOf(oldText),
        end: (files[path] ?? "").indexOf(oldText) + oldText.length,
      },
    }))),
    verify: { compile: true },
  };
}

describe("natural conversation file transactions", () => {
  it.each([
    "帮我就以下关键词取标题：HCC，NMF，scRNA，early screen，机器学习",
    "英文改写标题：《基于单细胞转录组与机器学习的肝细胞癌早期检测》",
  ])("keeps candidate exploration answer-only: %s", async (content) => {
    const user = withConversationArtifacts({ id: "u1", role: "user", content });
    const result = await runAssistant(request(content, [user]), {
      interpret: async () => ({
        ok: true,
        spec: {
          schemaVersion: "2",
          action: "advice",
          applyMode: "answer-only",
          contentMode: "none",
          scope: "active-file",
          evidenceMode: "none",
          targets: [],
        },
        sources: user.artifacts!,
        source: "llm",
        repaired: false,
      }),
      execute: async () => ({
        agent: { schemaVersion: "1", workflow: "advice", summary: "Title candidates", warnings: [] },
        content: "*First Candidate*\n*Second Candidate*",
        toolNotes: [],
      }),
    });
    expect(result.outcome).toBe("answer");
    expect(result.confirmation).toBeUndefined();
    expect(result.suggestions).toEqual([]);
    const savedReply = withConversationArtifacts({ id: "a1", role: "assistant", content: result.content });
    expect(savedReply.artifacts?.filter((artifact) => artifact.kind === "emphasis")).toHaveLength(2);
  });

  it("routes conversational title rewriting through streamed answer semantics, not a file workflow", async () => {
    const content = "英文改写标题：《基于单细胞转录组的肝细胞癌早期筛查》";
    const user = withConversationArtifacts({ id: "u1", role: "user", content });
    const result = await runAssistant(request(content, [user]), {
      interpret: async () => ({
        ok: true,
        spec: {
          schemaVersion: "2",
          action: "polish",
          applyMode: "answer-only",
          contentMode: "generate",
          scope: "manuscript",
          evidenceMode: "none",
          targets: [],
        },
        sources: user.artifacts!,
        source: "runtime",
        repaired: true,
      }),
      execute: async (input) => {
        expect(input.request.kind).toBe("advice");
        expect(input.request.plan?.applyToLatex).toBe(false);
        return {
          agent: { schemaVersion: "1", workflow: "advice", summary: "English title", warnings: [] },
          content: "Single-Cell Transcriptomics for Early Detection of Hepatocellular Carcinoma",
          toolNotes: [],
        };
      },
    });
    expect(result.outcome).toBe("answer");
    expect(result.suggestions).toEqual([]);
    expect(result.execution).toMatchObject({ taskSource: "runtime", action: "polish" });
  });

  it("directly prepares Diff/Keep when TaskSpec chooses a file transaction", async () => {
    const abstractSource = String.raw`\documentclass{article}
\begin{document}
\title{Old Title}
\begin{abstract}
Old abstract.
\end{abstract}
\section{Introduction}
Text.
\end{document}`;
    const user = withConversationArtifacts({ id: "u-abstract", role: "user", content: "请帮我重写摘要，使其更适合投稿" });
    const files = { "main.tex": abstractSource };
    const result = await runAssistant(request(user.content, [user], files), {
      interpret: async () => ({
        ok: true,
        spec: {
          schemaVersion: "2",
          action: "draft",
          applyMode: "propose-patch",
          contentMode: "generate",
          scope: "targets",
          evidenceMode: "none",
          targets: [{ slot: "abstract", sourceIds: [] }],
        },
        sources: user.artifacts!,
        source: "llm",
        repaired: false,
      }),
      execute: async (input) => ({
        agent: {
          schemaVersion: "1",
          workflow: input.request.kind,
          summary: "Write abstract",
          warnings: [],
          patch: await oneReplacePatch(files, "main.tex", "Old abstract.", "New abstract."),
        },
        content: "prepared",
        toolNotes: [],
      }),
    });
    expect(result.outcome).toBe("patch-proposed");
    expect(result.confirmation).toBeUndefined();
    expect(result.disambiguation).toBeUndefined();
    expect(result.suggestions).toHaveLength(1);
  });

  it("surfaces multi-target fill-section patches as separate Keep/Undo suggestions", async () => {
    const multiSource = String.raw`\documentclass{article}
\begin{document}
\section*{Funding}
Old funding.
\section*{Data availability}
Old data.
\end{document}`;
    const user = withConversationArtifacts({
      id: "u-multi",
      role: "user",
      content: "Funding: Grant 1.\nData availability: All data are included.",
    });
    const block = user.artifacts!.find((artifact) => artifact.kind === "block")!;
    const files = { "main.tex": multiSource };
    const result = await runAssistant(request(user.content, [user], files), {
      interpret: async () => ({
        ok: true,
        spec: {
          schemaVersion: "2",
          action: "fill-sections",
          applyMode: "propose-patch",
          contentMode: "provided",
          scope: "targets",
          evidenceMode: "none",
          targets: [
            { slot: "funding", sourceIds: [block.id] },
            { slot: "data-availability", sourceIds: [block.id] },
          ],
        },
        sources: user.artifacts!,
        source: "llm",
        repaired: false,
      }),
      execute: async (input) => {
        expect(input.request.resolvedTask?.targets.map((target) => target.providedText)).toEqual([
          "Grant 1.",
          "All data are included.",
        ]);
        return {
          agent: {
            schemaVersion: "1",
            workflow: input.request.kind,
            summary: "Fill manuscript sections",
            warnings: [],
            patch: await multiReplacePatch(files, [
              { path: "main.tex", oldText: "Old funding.", newText: "Grant 1." },
              { path: "main.tex", oldText: "Old data.", newText: "All data are included." },
            ]),
          },
          content: "prepared",
          toolNotes: [],
        };
      },
    });
    expect(result.outcome).toBe("patch-proposed");
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions.map((suggestion) => suggestion.patchSet?.operations)).toEqual([
      [expect.objectContaining({ oldText: "Old funding.", newText: "Grant 1." })],
      [expect.objectContaining({ oldText: "Old data.", newText: "All data are included." })],
    ]);
  });

  it("uses runtime high-confidence fallback for based-on-title introduction drafting when TaskSpec JSON fails", async () => {
    const user = withConversationArtifacts({ id: "u-intro", role: "user", content: "基于标题写一个引言" });
    const result = await runAssistant(request(user.content, [user]), {
      execute: async (input) => ({
        agent: {
          schemaVersion: "1",
          workflow: input.request.kind,
          summary: "Write introduction",
          warnings: [],
          patch: await oneReplacePatch({ "main.tex": source }, "main.tex", "Text.", "Generated introduction."),
        },
        content: "prepared",
        toolNotes: [],
      }),
    });
    expect(result.outcome).toBe("patch-proposed");
    expect(result.execution).toMatchObject({ taskSource: "runtime", action: "draft" });
    expect(result.confirmation).toBeUndefined();
    expect(result.suggestions).toHaveLength(1);
  });

  it("creates a canonical title PatchSet immediately after context resolution", async () => {
    const user = withConversationArtifacts({
      id: "u3",
      role: "user",
      content: "修改标题为Single-Cell Transcriptomic NMF Patterns and Machine Learning",
    });
    const conversation = [user];
    const payload = user.artifacts!.find((artifact) => artifact.kind === "assignment-value")!;
    const first = await runAssistant(request(user.content, conversation), {
      interpret: async () => exactTitleTask(user.artifacts!, payload.id),
    });
    expect(first.outcome).toBe("patch-proposed");
    expect(first.confirmation).toBeUndefined();
    expect(first.disambiguation).toBeUndefined();
    expect(first.suggestions).toHaveLength(1);
    const patch = first.agent.patch!;
    const simulated = await simulatePatchSet({ "main.tex": source }, patch);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]).toContain(`\\title{${payload.text}}`);
      expect(simulated.simulation.nextFiles["main.tex"]?.match(/\\title\b/g)).toHaveLength(1);
    }
  });

  it("uses the canonical manuscript target instead of opening a target-selection card", async () => {
    const files = {
      "main.tex": "\\documentclass{article}\n\\begin{document}\n\\title{Main Title}\n\\input{front/title}\n\\end{document}",
      "front/title.tex": "\\title{Included Title}",
    };
    const user = withConversationArtifacts({
      id: "u-ambiguous-title",
      role: "user",
      content: "Change the title to Graph-Selected Title",
    });
    const payload = user.artifacts!.find((artifact) => artifact.kind === "assignment-value")!;
    const conversation = [user];
    const first = await runAssistant(request(user.content, conversation, files), {
      interpret: async () => exactTitleTask(user.artifacts!, payload.id),
    });
    expect(first.outcome).toBe("patch-proposed");
    expect(first.disambiguation).toBeUndefined();
    expect(first.confirmation).toBeUndefined();
    const simulated = await simulatePatchSet(files, first.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]).toContain("\\title{Graph-Selected Title}");
      expect(simulated.simulation.nextFiles["front/title.tex"]).toContain("\\title{Included Title}");
    }
  });

  it("can bind an exact historical assistant candidate by artifact id", async () => {
    const assistant = withConversationArtifacts({
      id: "a2",
      role: "assistant",
      content: "*First Title*\n*Second Title*\n*Third Exact Title*",
    });
    const user = withConversationArtifacts({ id: "u3", role: "user", content: "采用第 3 个标题" });
    const conversation = [assistant, user];
    const third = assistant.artifacts!.filter((artifact) => artifact.kind === "emphasis")[2]!;
    const allSources = [...assistant.artifacts!, ...user.artifacts!];
    const result = await runAssistant(request(user.content, conversation), {
      interpret: async () => exactTitleTask(allSources, third.id),
    });
    expect(result.outcome).toBe("patch-proposed");
    expect(result.confirmation).toBeUndefined();
    expect(result.suggestions).toHaveLength(1);
    const simulated = await simulatePatchSet({ "main.tex": source }, result.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]).toContain("\\title{Third Exact Title}");
    }
  });

  it("blocks an invalid TaskSpec instead of silently answering as advice", async () => {
    const user = withConversationArtifacts({ id: "u1", role: "user", content: "修改标题为New Title" });
    const result = await runAssistant(request(user.content, [user]), {
      interpret: async () => ({
        ok: false,
        sources: user.artifacts!,
        source: "invalid",
        repaired: true,
        error: "The model could not produce TaskSpec v2",
      }),
    });
    expect(result.outcome).toBe("blocked");
    expect(result.content).toContain("未修改项目文件");
    expect(result.suggestions).toEqual([]);
  });

  it("lets an explicit slash action bypass the confirmation card", async () => {
    const user = withConversationArtifacts({ id: "u1", role: "user", content: "/write 修改标题为Direct Title" });
    const payload = user.artifacts!.find((artifact) => artifact.kind === "assignment-value")!;
    const result = await runAssistant(request(user.content, [user]), {
      interpret: async () => exactTitleTask(user.artifacts!, payload.id),
    });
    expect(result.outcome).toBe("patch-proposed");
    expect(result.confirmation).toBeUndefined();
    expect(result.suggestions).toHaveLength(1);
  });

  it("prepares a selection transaction immediately without a confirmation card", async () => {
    const selected = "Old Title";
    const user = withConversationArtifacts({ id: "u1", role: "user", content: "修改所选标题为New Title" });
    const payload = user.artifacts!.find((artifact) => artifact.kind === "assignment-value")!;
    const selectedRequest = {
      ...request(user.content, [user]),
      ctx: {
        ...request(user.content, [user]).ctx,
        selection: { start: source.indexOf(selected), end: source.indexOf(selected) + selected.length },
      },
    };
    const first = await runAssistant(selectedRequest, {
      interpret: async () => ({
        ...exactTitleTask(user.artifacts!, payload.id),
        spec: {
          schemaVersion: "2",
          action: "fill-sections",
          applyMode: "propose-patch",
          contentMode: "provided",
          scope: "selection",
          evidenceMode: "none",
          targets: [{ slot: "title", sourceIds: [payload.id] }],
        },
      }),
    });
    expect(first.outcome).toBe("patch-proposed");
    expect(first.confirmation).toBeUndefined();
    expect(first.suggestions).toHaveLength(1);
  });

  it("uses the current revision when preparing the immediate semantic patch", async () => {
    const user = withConversationArtifacts({ id: "u1", role: "user", content: "修改标题为Revision-Safe Title" });
    const payload = user.artifacts!.find((artifact) => artifact.kind === "assignment-value")!;
    const changedSource = source.replace("\\begin{document}", "\\begin{document}\n% unrelated edit before title");
    const result = await runAssistant(request(user.content, [user], { "main.tex": changedSource }), {
      interpret: async () => exactTitleTask(user.artifacts!, payload.id),
    });
    expect(result.outcome).toBe("patch-proposed");
    const simulated = await simulatePatchSet({ "main.tex": changedSource }, result.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]).toContain("\\title{Revision-Safe Title}");
    }
  });
});
