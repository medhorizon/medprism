import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../types/chat";
import {
  adoptProjectChat,
  clearSessionChat,
  getSessionChat,
  isSessionSending,
  persistDurableChat,
  setSessionChat,
} from "./projectChatSession";

const storage = new Map<string, string>();

vi.mock("./projectArtifacts", () => ({
  saveProjectChat: (projectId: string, messages: ChatMessage[]) => {
    storage.set(projectId, JSON.stringify(messages));
    return true;
  },
}));

describe("projectChatSession", () => {
  beforeEach(() => {
    storage.clear();
    clearSessionChat("a");
    clearSessionChat("b");
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
});
