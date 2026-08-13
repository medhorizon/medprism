import { runAssistant, type RuntimeRequest, type RuntimeResult } from "../lib/assistantRuntime";
import { LlmClientError, type ChatRequestMessage, type LlmConfig } from "../lib/llmClient";
import type { WorkflowKind } from "../lib/workflows/types";
import type { ChatMessage } from "../types/chat";
import { saveProjectChat } from "./projectArtifacts";

type SessionState = {
  messages: ChatMessage[];
  sending: boolean;
  runId: number;
  controller?: AbortController;
};

type Listener = () => void;

const sessions = new Map<string, SessionState>();
const listeners = new Set<Listener>();

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({ ...message }));
}

function ensure(projectId: string): SessionState {
  let session = sessions.get(projectId);
  if (!session) {
    session = { messages: [], sending: false, runId: 0 };
    sessions.set(projectId, session);
  }
  return session;
}

function emit() {
  for (const listener of listeners) listener();
}

function hasPending(messages: ChatMessage[]): boolean {
  return messages.some((message) => message.pending === true);
}

/** Persist only finished chats; never write in-flight "thinking" placeholders. */
export function persistDurableChat(
  projectId: string,
  messages: ChatMessage[] = ensure(projectId).messages,
): boolean {
  if (!projectId.trim() || hasPending(messages)) return false;
  return saveProjectChat(projectId, messages);
}

export function getSessionChat(projectId: string): ChatMessage[] {
  if (!projectId.trim()) return [];
  return cloneMessages(ensure(projectId).messages);
}

export function isSessionSending(projectId: string): boolean {
  if (!projectId.trim()) return false;
  return ensure(projectId).sending;
}

export function subscribeProjectChat(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Prefer the live in-memory session (including in-flight replies).
 * Otherwise seed from disk/fallback.
 */
export function adoptProjectChat(
  projectId: string,
  fallback: ChatMessage[],
): ChatMessage[] {
  if (!projectId.trim()) return cloneMessages(fallback);
  const session = ensure(projectId);
  if (session.messages.length > 0 || session.sending) {
    return cloneMessages(session.messages);
  }
  session.messages = cloneMessages(fallback);
  return cloneMessages(session.messages);
}

export function setSessionChat(
  projectId: string,
  messages: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[]),
  options?: { persist?: boolean },
): ChatMessage[] {
  if (!projectId.trim()) return [];
  const session = ensure(projectId);
  session.messages =
    typeof messages === "function"
      ? messages(cloneMessages(session.messages))
      : cloneMessages(messages);
  emit();
  if (options?.persist) persistDurableChat(projectId, session.messages);
  return cloneMessages(session.messages);
}

export function clearSessionChat(projectId: string): void {
  if (!projectId.trim()) return;
  sessions.get(projectId)?.controller?.abort();
  sessions.delete(projectId);
  emit();
}

export function stopProjectAssistant(projectId: string, stoppedContent: string): boolean {
  if (!projectId.trim()) return false;
  const session = ensure(projectId);
  if (!session.sending) return false;
  session.runId += 1;
  session.controller?.abort();
  session.controller = undefined;
  session.sending = false;
  session.messages = session.messages.map((message) =>
    message.pending ? { ...message, content: stoppedContent, pending: undefined } : message,
  );
  persistDurableChat(projectId, session.messages);
  emit();
  return true;
}

/** App is closing: stop runs and persist what we can (pending → interrupted via saveProjectChat). */
export function shutdownProjectChats(interruptedContent: string): void {
  for (const [projectId, session] of sessions) {
    session.runId += 1;
    session.controller?.abort();
    session.controller = undefined;
    session.sending = false;
    saveProjectChat(projectId, session.messages, localStorage, interruptedContent);
  }
  emit();
}

export type ProjectAssistantRequest = {
  projectId: string;
  config: LlmConfig;
  /** Text shown in the chat transcript. */
  displayUserText: string;
  /** Text sent to the model / router (may differ for review chips). */
  userText: string;
  history: ChatRequestMessage[];
  workflow: "auto" | WorkflowKind;
  ctx: RuntimeRequest["ctx"];
  thinkingLabel: string;
  mapError: (error: unknown) => string;
  onComplete?: (result: RuntimeResult) => void | Promise<void>;
};

/**
 * Start an assistant turn scoped to a project. Continues after the user switches
 * projects while MedPrism stays open; persists chat only when the turn finishes.
 */
export async function startProjectAssistant(
  request: ProjectAssistantRequest,
): Promise<boolean> {
  const projectId = request.projectId.trim();
  if (!projectId) return false;
  const session = ensure(projectId);
  if (session.sending) return false;

  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: request.displayUserText,
  };
  const thinkingId = crypto.randomUUID();
  const runId = ++session.runId;
  const controller = new AbortController();
  session.controller = controller;
  session.messages = [
    ...session.messages,
    userMessage,
    {
      id: thinkingId,
      role: "assistant",
      content: request.thinkingLabel,
      pending: true,
    },
  ];
  session.sending = true;
  emit();

  const stillThisRun = () => ensure(projectId).runId === runId;

  try {
    let streamed = "";
    const result = await runAssistant({
      mode: "assistant",
      config: request.config,
      userText: request.userText,
      history: request.history,
      workflow: request.workflow,
      ctx: request.ctx,
      signal: controller.signal,
      onDelta: (delta) => {
        if (!stillThisRun()) return;
        streamed += delta;
        const content = streamed;
        const current = ensure(projectId);
        current.messages = current.messages.map((message) =>
          message.id === thinkingId
            ? { ...message, content, pending: true }
            : message,
        );
        emit();
      },
    });

    if (!stillThisRun()) return false;

    await request.onComplete?.(result);

    if (!stillThisRun()) return false;

    const primarySuggestion = result.suggestions[0];
    const extra = result.suggestions.slice(1).map((suggestion) => ({
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: suggestion.title || "Additional suggestion",
      suggestion,
    }));
    const current = ensure(projectId);
    current.messages = [
      ...current.messages.map((message) =>
        message.id === thinkingId
          ? {
              id: message.id,
              role: message.role,
              content: result.content,
              suggestion: primarySuggestion,
            }
          : message,
      ),
      ...extra,
    ];
    persistDurableChat(projectId, current.messages);
    emit();
    return true;
  } catch (error) {
    if (!stillThisRun()) return false;
    if (
      error instanceof LlmClientError &&
      error.code === "timeout" &&
      /abort/i.test(error.message)
    ) {
      // App shutdown / explicit cancel — leave finalize to shutdownProjectChats.
      return false;
    }
    const current = ensure(projectId);
    current.messages = current.messages.map((message) =>
      message.id === thinkingId
        ? {
            id: message.id,
            role: message.role,
            content: request.mapError(error),
          }
        : message,
    );
    persistDurableChat(projectId, current.messages);
    emit();
    if (error instanceof LlmClientError && error.code === "not_configured") {
      throw error;
    }
    return false;
  } finally {
    const current = ensure(projectId);
    if (current.runId === runId) {
      current.controller = undefined;
      current.sending = false;
      emit();
    }
  }
}
