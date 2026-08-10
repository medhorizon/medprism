import { describe, expect, it } from "vitest";
import { LLM_HISTORY_MAX_MESSAGES, toLlmHistory } from "./chatHistory";
import type { ChatMessage } from "../types/chat";

describe("toLlmHistory", () => {
  it("drops welcome and pending rows, keeps recent turns", () => {
    const messages: ChatMessage[] = [
      { id: "a1", role: "assistant", content: "Welcome" },
      { id: "u1", role: "user", content: "Polish abstract" },
      { id: "a2", role: "assistant", content: "Done", pending: true },
      { id: "u2", role: "user", content: "Tighten claims" },
      { id: "a3", role: "assistant", content: "Revised" },
    ];
    expect(toLlmHistory(messages, "Next ask")).toEqual([
      { role: "user", content: "Polish abstract" },
      { role: "user", content: "Tighten claims" },
      { role: "assistant", content: "Revised" },
      { role: "user", content: "Next ask" },
    ]);
  });

  it("caps at LLM_HISTORY_MAX_MESSAGES", () => {
    const messages: ChatMessage[] = Array.from({ length: 80 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg-${index}`,
    }));
    const history = toLlmHistory(messages);
    expect(history).toHaveLength(LLM_HISTORY_MAX_MESSAGES);
    expect(history[0]?.content).toBe(`msg-${80 - LLM_HISTORY_MAX_MESSAGES}`);
  });
});
