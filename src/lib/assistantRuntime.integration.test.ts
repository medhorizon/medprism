import { describe, expect, it } from "vitest";
import { runAssistant } from "./assistantRuntime";
import { buildConversationArtifacts, withConversationArtifacts } from "./conversationArtifacts";
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

  it("asks for confirmation, then creates a canonical title PatchSet without reinterpreting", async () => {
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
    expect(first.outcome).toBe("confirmation-required");
    expect(first.suggestions).toEqual([]);
    expect(first.confirmation?.targets[0]).toMatchObject({ slot: "Title", preview: payload.text });

    const confirmed = await runAssistant({
      ...request("确认", conversation),
      resumeTask: first.confirmation,
    });
    expect(confirmed.outcome).toBe("patch-proposed");
    expect(confirmed.suggestions).toHaveLength(1);
    const patch = confirmed.agent.patch!;
    const simulated = await simulatePatchSet({ "main.tex": source }, patch);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]).toContain(`\\title{${payload.text}}`);
      expect(simulated.simulation.nextFiles["main.tex"]?.match(/\\title\b/g)).toHaveLength(1);
    }
  });

  it("asks the user to choose when a real active manuscript graph has multiple title targets", async () => {
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
    expect(first.outcome).toBe("disambiguation-required");
    expect(first.suggestions).toEqual([]);
    expect(first.disambiguation?.choices.map((choice) => choice.path)).toEqual([
      "main.tex",
      "front/title.tex",
    ]);

    const includedChoice = first.disambiguation!.choices.find((choice) => choice.path === "front/title.tex")!;
    const selected = await runAssistant({
      ...request("Select target", conversation, files),
      resumeDisambiguation: { task: first.disambiguation!, choiceId: includedChoice.id },
    });
    expect(selected.outcome).toBe("confirmation-required");
    expect(selected.confirmation?.targets[0]).toMatchObject({ path: "front/title.tex", preview: payload.text });

    const confirmed = await runAssistant({
      ...request("confirm", conversation, files),
      resumeTask: selected.confirmation,
    });
    expect(confirmed.outcome).toBe("patch-proposed");
    const simulated = await simulatePatchSet(files, confirmed.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]).toContain("\\title{Main Title}");
      expect(simulated.simulation.nextFiles["front/title.tex"]).toContain("\\title{Graph-Selected Title}");
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
    expect(result.outcome).toBe("confirmation-required");
    expect(result.confirmation?.targets[0]?.preview).toBe("Third Exact Title");
    expect(result.confirmation?.sources[0]?.text).toBe("Third Exact Title");
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

  it("blocks a confirmed selection transaction when the selection changed", async () => {
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
    expect(first.outcome).toBe("confirmation-required");

    const changedSelectionRequest = {
      ...request("确认", [user]),
      ctx: {
        ...request("确认", [user]).ctx,
        selection: { start: source.indexOf("Text."), end: source.indexOf("Text.") + "Text.".length },
      },
      resumeTask: first.confirmation,
    };
    const result = await runAssistant(changedSelectionRequest);
    expect(result.outcome).toBe("blocked");
    expect(result.execution.failureCode).toBe("SELECTION_STALE");
    expect(result.suggestions).toEqual([]);
  });

  it("re-resolves a semantic slot against the current revision after confirmation", async () => {
    const user = withConversationArtifacts({ id: "u1", role: "user", content: "修改标题为Revision-Safe Title" });
    const payload = user.artifacts!.find((artifact) => artifact.kind === "assignment-value")!;
    const first = await runAssistant(request(user.content, [user]), {
      interpret: async () => exactTitleTask(user.artifacts!, payload.id),
    });
    const changedSource = source.replace("\\begin{document}", "\\begin{document}\n% unrelated edit before title");
    const confirmed = await runAssistant({
      ...request("确认", [user]),
      ctx: {
        ...request("确认", [user]).ctx,
        files: { "main.tex": changedSource },
      },
      resumeTask: first.confirmation,
    });
    expect(confirmed.outcome).toBe("patch-proposed");
    const simulated = await simulatePatchSet({ "main.tex": changedSource }, confirmed.agent.patch!);
    expect(simulated.ok).toBe(true);
    if (simulated.ok) {
      expect(simulated.simulation.nextFiles["main.tex"]).toContain("\\title{Revision-Safe Title}");
    }
  });
});
