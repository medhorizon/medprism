import type { ChatRequestMessage } from "./llmClient";
import type { ChatMessage } from "../types/chat";

/** Max prior turns sent to the model (UI may keep more in localStorage). */
export const LLM_HISTORY_MAX_MESSAGES = 36;

/** Classifier only needs a short recent window. */
export const LLM_CLASSIFIER_HISTORY_MAX = 12;

/**
 * Build OpenAI-style chat history for the next model call.
 * Drops the welcome placeholder and in-flight "thinking" rows.
 */
export function toLlmHistory(
  messages: ChatMessage[],
  pendingUserText?: string,
  maxMessages: number = LLM_HISTORY_MAX_MESSAGES,
): ChatRequestMessage[] {
  const rows: Array<{ id: string; role: "user" | "assistant"; content: string }> = [
    ...messages,
  ];
  if (pendingUserText?.trim()) {
    rows.push({
      id: "pending-user",
      role: "user",
      content: pendingUserText.trim(),
    });
  }
  return rows
    .filter((message) => message.id !== "a1" && !(message as ChatMessage).pending)
    .filter((message) => message.content.trim().length > 0)
    .slice(-Math.max(1, maxMessages))
    .map((message) => ({ role: message.role, content: message.content }));
}
