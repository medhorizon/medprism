import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../types/chat";
import { buildConversationArtifacts } from "../lib/conversationArtifacts";
import { runAssistant } from "../lib/assistantRuntime";
import {
  adoptProjectChat,
  clearSessionChat,
  getSessionChat,
  isSessionSending,
  persistDurableChat,
  setSessionChat,
  shutdownProjectChats,
  startProjectAssistant,
} from "./projectChatSession";

const storage = new Map<string, string>();

function pendingConfirmation(): ChatMessage {
  const sources = buildConversationArtifacts({ messageId: "u-edit", role: "user", content: "修改标题为New Title" });
  const source = sources.find((artifact) => artifact.kind === "assignment-value")!;
  const task = {
    schemaVersion: "1" as const,
    id: "task-1",
    projectId: "a",
    projectRevision: "revision-1",
    createdAt: new Date().toISOString(),
    status: "awaiting-confirmation" as const,
    spec: {
      schemaVersion: "2" as const,
      action: "fill-sections" as const,
      applyMode: "propose-patch" as const,
      contentMode: "provided" as const,
      scope: "targets" as const,
      evidenceMode: "none" as const,
      targets: [{ slot: "title" as const, sourceIds: [source.id] }],
    },
    sources: [source],
    targets: [{ id: "title", slot: "Title", operation: "replace" as const, preview: source.text }],
  };
  return {
    id: "a-confirm",
    role: "assistant",
    content: "Confirm",
    confirmation: { task, status: "awaiting-confirmation" },
  };
}

function answerResult(content = "done") {
  return {
    agent: { schemaVersion: "1" as const, workflow: "advice" as const, summary: "done", warnings: [] },
    content,
    suggestions: [],
    toolNotes: [],
    outcome: "answer" as const,
    execution: { schemaVersion: "1" as const, outcome: "answer" as const, taskSource: "locked" as const, action: "advice" as const, targetCount: 0 },
  };
}

vi.mock("./projectArtifacts", () => ({
  saveProjectChat: (
    projectId: string,
    messages: ChatMessage[],
    _storage?: unknown,
    interrupted = "Interrupted",
  ) => {
    storage.set(projectId, JSON.stringify(messages.map((message) =>
      message.pending ? { id: message.id, role: message.role, content: interrupted } : message,
    )));
    return true;
  },
}));

vi.mock("../lib/assistantRuntime", () => ({
  runAssistant: vi.fn(),
}));

describe("projectChatSession", () => {
  beforeEach(() => {
    storage.clear();
    clearSessionChat("a");
    clearSessionChat("b");
    vi.mocked(runAssistant).mockReset();
    vi.stubGlobal("localStorage", {});
  });

  it("keeps live session chat when switching projects via adopt", () => {
    setSessionChat("a", [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "正在思考…", pending: true },
    ]);
    expect(adoptProjectChat("b", [{ id: "x", role: "assistant", content: "fallback" }])).toEqual([
      { id: "x", role: "assistant", content: "fallback" },
    ]);
    expect(adoptProjectChat("a", [{ id: "y", role: "assistant", content: "disk" }])).toEqual([
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "正在思考…", pending: true },
    ]);
  });

  it("does not persist while a reply is pending", () => {
    setSessionChat("a", [
      { id: "a1", role: "assistant", content: "Thinking…", pending: true },
    ]);
    expect(persistDurableChat("a")).toBe(false);
    expect(storage.has("a")).toBe(false);

    setSessionChat("a", [{ id: "a1", role: "assistant", content: "done" }], {
      persist: true,
    });
    expect(storage.get("a")).toEqual(
      JSON.stringify([{ id: "a1", role: "assistant", content: "done" }]),
    );
    expect(isSessionSending("a")).toBe(false);
    expect(getSessionChat("a")[0]?.content).toBe("done");
  });

  it("keeps streaming a request into its original project after a project switch", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(runAssistant).mockImplementation(async (request) => {
      request.onDelta?.("First");
      await gate;
      request.onDelta?.(" second");
      return {
        agent: { schemaVersion: "1", workflow: "advice", summary: "done", warnings: [] },
        content: "First second",
        suggestions: [],
        toolNotes: [],
        outcome: "answer",
        execution: { schemaVersion: "1", outcome: "answer", taskSource: "locked", action: "advice", targetCount: 0 },
      };
    });
    const pending = startProjectAssistant({
      projectId: "a",
      config: { mode: "mock" },
      displayUserText: "check",
      userText: "check",
      history: [],
      workflow: "advice",
      ctx: { projectId: "a", files: { "main.tex": "text" } },
      thinkingLabel: "Thinking",
      mapError: String,
    });
    await Promise.resolve();
    expect(getSessionChat("a").at(-1)).toMatchObject({ content: "First", pending: true });
    adoptProjectChat("b", [{ id: "b1", role: "assistant", content: "Project B" }]);
    finish();
    expect(await pending).toBe(true);
    expect(getSessionChat("a").at(-1)).toMatchObject({ content: "First second" });
    expect(getSessionChat("b").at(-1)?.content).toBe("Project B");
    expect(storage.get("a")).toContain("First second");
  });

  it("persists in-flight replies as interrupted on app shutdown", () => {
    setSessionChat("a", [
      { id: "u1", role: "user", content: "check" },
      { id: "a1", role: "assistant", content: "partial", pending: true },
    ]);
    shutdownProjectChats("Interrupted by shutdown");
    expect(storage.get("a")).toContain("Interrupted by shutdown");
    expect(storage.get("a")).not.toContain('"pending":true');
  });

  it("cancels a pending file task without calling the model", async () => {
    setSessionChat("a", [pendingConfirmation()]);
    const completed = await startProjectAssistant({
      projectId: "a",
      config: { mode: "mock" },
      displayUserText: "取消",
      userText: "取消",
      history: [],
      workflow: "auto",
      confirmationControl: { taskId: "task-1", action: "cancel" },
      ctx: { projectId: "a", files: { "main.tex": "text" } },
      thinkingLabel: "Thinking",
      mapError: String,
    });
    expect(completed).toBe(true);
    expect(runAssistant).not.toHaveBeenCalled();
    expect(getSessionChat("a")[0]?.confirmation?.status).toBe("cancelled");
  });

  it("resumes confirmation without reinterpreting and supersedes it on a new request", async () => {
    vi.mocked(runAssistant).mockResolvedValue(answerResult());
    setSessionChat("a", [pendingConfirmation()]);
    await startProjectAssistant({
      projectId: "a",
      config: { mode: "mock" },
      displayUserText: "确认",
      userText: "确认",
      history: [],
      workflow: "auto",
      confirmationControl: { taskId: "task-1", action: "confirm" },
      ctx: { projectId: "a", files: { "main.tex": "text" } },
      thinkingLabel: "Thinking",
      mapError: String,
    });
    expect(vi.mocked(runAssistant).mock.calls[0]?.[0].resumeTask?.id).toBe("task-1");
    expect(getSessionChat("a")[0]?.confirmation?.status).toBe("confirmed");

    clearSessionChat("a");
    setSessionChat("a", [pendingConfirmation()]);
    await startProjectAssistant({
      projectId: "a",
      config: { mode: "mock" },
      displayUserText: "换一个更短的版本",
      userText: "换一个更短的版本",
      history: [],
      workflow: "auto",
      ctx: { projectId: "a", files: { "main.tex": "text" } },
      thinkingLabel: "Thinking",
      mapError: String,
    });
    expect(getSessionChat("a")[0]?.confirmation?.status).toBe("superseded");
  });

  it("ignores a stale confirmation control without changing the current task", async () => {
    setSessionChat("a", [pendingConfirmation()]);
    const completed = await startProjectAssistant({
      projectId: "a",
      config: { mode: "mock" },
      displayUserText: "确认",
      userText: "确认",
      history: [],
      workflow: "auto",
      confirmationControl: { taskId: "older-task", action: "confirm" },
      ctx: { projectId: "a", files: { "main.tex": "text" } },
      thinkingLabel: "Thinking",
      mapError: String,
    });
    expect(completed).toBe(false);
    expect(runAssistant).not.toHaveBeenCalled();
    expect(getSessionChat("a")[0]?.confirmation?.status).toBe("awaiting-confirmation");
  });

  it("resumes a pending task from an unqualified natural confirmation", async () => {
    vi.mocked(runAssistant).mockResolvedValue(answerResult());
    setSessionChat("a", [pendingConfirmation()]);
    expect(await startProjectAssistant({
      projectId: "a",
      config: { mode: "mock" },
      displayUserText: "继续",
      userText: "继续",
      history: [],
      workflow: "auto",
      ctx: { projectId: "a", files: { "main.tex": "text" } },
      thinkingLabel: "Thinking",
      mapError: String,
    })).toBe(true);
    expect(vi.mocked(runAssistant).mock.calls[0]?.[0].resumeTask?.id).toBe("task-1");
  });

  it("keeps a confirmed task retryable when execution fails before a PatchSet", async () => {
    vi.mocked(runAssistant).mockRejectedValue(new Error("transport failed"));
    setSessionChat("a", [pendingConfirmation()]);
    expect(await startProjectAssistant({
      projectId: "a",
      config: { mode: "mock" },
      displayUserText: "确认",
      userText: "确认",
      history: [],
      workflow: "auto",
      ctx: { projectId: "a", files: { "main.tex": "text" } },
      thinkingLabel: "Thinking",
      mapError: () => "failed",
    })).toBe(false);
    expect(getSessionChat("a")[0]?.confirmation?.status).toBe("awaiting-confirmation");
  });
});
