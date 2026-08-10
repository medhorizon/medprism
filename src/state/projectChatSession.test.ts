import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../types/chat";
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
});
