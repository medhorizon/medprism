import { describe, expect, it } from "vitest";
import {
  clearProjectArtifacts,
  finalizeChatMessages,
  loadProjectChat,
  loadProjectMemory,
  loadProjectPdf,
  saveProjectChat,
  saveProjectMemory,
  saveProjectPdf,
  type StorageLike,
} from "./projectArtifacts";
import type { ChatMessage } from "../types/chat";
import { buildConversationArtifacts } from "../lib/conversationArtifacts";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

describe("projectArtifacts", () => {
  it("round-trips assistant chat for a project", () => {
    const storage = memoryStorage();
    const messages: ChatMessage[] = [
      { id: "a1", role: "assistant", content: "Hello" },
      { id: "u1", role: "user", content: "Write a title" },
      {
        id: "a2",
        role: "assistant",
        content: "Proposed title",
        suggestion: {
          title: "Write title",
          body: "",
          status: "pending",
          path: "sn-article.tex",
        },
      },
    ];
    expect(saveProjectChat("proj-1", messages, storage)).toBe(true);
    const loaded = loadProjectChat("proj-1", storage)!;
    expect(loaded.map(({ artifacts: _artifacts, ...message }) => message)).toEqual(messages);
    expect(loaded.every((message) => (message.artifacts?.length ?? 0) > 0)).toBe(true);
    expect(loadProjectChat("other", storage)).toBeNull();
  });

  it("round-trips compiled PDF keyed by files revision", () => {
    const storage = memoryStorage();
    expect(saveProjectPdf("proj-1", "rev-abc", "JVBERi0x", storage)).toBe(true);
    expect(loadProjectPdf("proj-1", storage)).toEqual({
      schemaVersion: 1,
      filesRevision: "rev-abc",
      pdfBase64: "JVBERi0x",
      updatedAt: expect.any(String),
    });
  });

  it("round-trips optional project memory notes", () => {
    const storage = memoryStorage();
    expect(saveProjectMemory("proj-1", "  Target: Nature  \n", storage)).toBe(true);
    expect(loadProjectMemory("proj-1", storage)).toBe("Target: Nature");
    expect(saveProjectMemory("proj-1", "   ", storage)).toBe(true);
    expect(loadProjectMemory("proj-1", storage)).toBe("");
  });

  it("clears chat, PDF, and memory together", () => {
    const storage = memoryStorage();
    saveProjectChat("proj-1", [{ id: "a1", role: "assistant", content: "Hi" }], storage);
    saveProjectPdf("proj-1", "rev", "pdf", storage);
    saveProjectMemory("proj-1", "journal prefs", storage);
    clearProjectArtifacts("proj-1", storage);
    expect(loadProjectChat("proj-1", storage)).toBeNull();
    expect(loadProjectPdf("proj-1", storage)).toBeNull();
    expect(loadProjectMemory("proj-1", storage)).toBe("");
  });

  it("does not persist in-flight thinking placeholders", () => {
    const storage = memoryStorage();
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hello" },
      {
        id: "a2",
        role: "assistant",
        content: "正在思考…",
        pending: true,
      },
    ];
    expect(saveProjectChat("proj-1", messages, storage, "已中断")).toBe(true);
    expect(loadProjectChat("proj-1", storage)?.map(({ artifacts: _artifacts, ...message }) => message)).toEqual([
      { id: "u1", role: "user", content: "hello" },
      { id: "a2", role: "assistant", content: "已中断" },
    ]);
  });

  it("finalizes legacy Thinking… placeholders on load", () => {
    const storage = memoryStorage();
    storage.setItem(
      "medprism.projectChat.proj-1",
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        messages: [
          { id: "a1", role: "assistant", content: "Thinking…" },
        ],
      }),
    );
    expect(loadProjectChat("proj-1", storage, "Interrupted")?.map(({ artifacts: _artifacts, ...message }) => message)).toEqual([
      { id: "a1", role: "assistant", content: "Interrupted" },
    ]);
    expect(
      finalizeChatMessages(
        [{ id: "a1", role: "assistant", content: "ok", pending: true }],
        "Interrupted",
      ).map(({ artifacts: _artifacts, ...message }) => message),
    ).toEqual([{ id: "a1", role: "assistant", content: "Interrupted" }]);
  });

  it("persists and restores a revision-bound pending confirmation", () => {
    const storage = memoryStorage();
    const artifacts = buildConversationArtifacts({ messageId: "u1", role: "user", content: "修改标题为New Title" });
    const source = artifacts.find((artifact) => artifact.kind === "assignment-value")!;
    const task = {
      schemaVersion: "1" as const,
      id: "task-1",
      projectId: "proj-1",
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
      targets: [{ id: "title", slot: "Title", operation: "replace" as const }],
    };
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "修改标题为New Title", artifacts },
      {
        id: "a1",
        role: "assistant",
        content: "Confirm",
        confirmation: { task, status: "awaiting-confirmation" },
      },
    ];
    expect(saveProjectChat("proj-1", messages, storage)).toBe(true);
    expect(loadProjectChat("proj-1", storage)?.[1]?.confirmation?.task).toMatchObject({
      id: "task-1",
      projectRevision: "revision-1",
      status: "awaiting-confirmation",
    });
  });

  it("persists and restores a revision-bound pending target disambiguation", () => {
    const storage = memoryStorage();
    const artifacts = buildConversationArtifacts({ messageId: "u1", role: "user", content: "Change the title to New Title" });
    const source = artifacts.find((artifact) => artifact.kind === "assignment-value")!;
    const task = {
      schemaVersion: "1" as const,
      id: "disamb-1",
      projectId: "proj-1",
      projectRevision: "revision-1",
      createdAt: new Date().toISOString(),
      status: "awaiting-disambiguation" as const,
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
      taskSource: "llm" as const,
      repaired: false,
      explicitlyAuthorized: false,
      choices: [{
        id: "choice-1",
        targetIndex: 0,
        occurrenceId: "slot:main",
        slot: "Title",
        path: "main.tex",
        syntax: "command",
        heading: "Title",
      }],
    };
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "Change the title to New Title", artifacts },
      {
        id: "a1",
        role: "assistant",
        content: "Choose target",
        disambiguation: { task, status: "awaiting-disambiguation" },
      },
    ];
    expect(saveProjectChat("proj-1", messages, storage)).toBe(true);
    expect(loadProjectChat("proj-1", storage)?.[1]?.disambiguation?.task).toMatchObject({
      id: "disamb-1",
      choices: [{ id: "choice-1", path: "main.tex" }],
      status: "awaiting-disambiguation",
    });
  });

  it("expires a restored pending task when its source message is unavailable", () => {
    const storage = memoryStorage();
    const artifacts = buildConversationArtifacts({ messageId: "missing", role: "assistant", content: "*Historical Title*" });
    const source = artifacts.find((artifact) => artifact.kind === "emphasis")!;
    const task = {
      schemaVersion: "1" as const,
      id: "task-missing-source",
      projectId: "proj-1",
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
      targets: [{ id: "title", slot: "Title", operation: "replace" as const }],
    };
    expect(saveProjectChat("proj-1", [{
      id: "a1",
      role: "assistant",
      content: "Confirm",
      confirmation: { task, status: "awaiting-confirmation" },
    }], storage)).toBe(true);
    expect(loadProjectChat("proj-1", storage)?.[0]?.confirmation?.status).toBe("expired");
  });
});
