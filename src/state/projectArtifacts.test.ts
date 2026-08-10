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
    expect(loadProjectChat("proj-1", storage)).toEqual(messages);
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
    expect(loadProjectChat("proj-1", storage)).toEqual([
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
    expect(loadProjectChat("proj-1", storage, "Interrupted")).toEqual([
      { id: "a1", role: "assistant", content: "Interrupted" },
    ]);
    expect(
      finalizeChatMessages(
        [{ id: "a1", role: "assistant", content: "ok", pending: true }],
        "Interrupted",
      ),
    ).toEqual([{ id: "a1", role: "assistant", content: "Interrupted" }]);
  });
});
