import { runAssistant, type RuntimeRequest, type RuntimeResult } from "../lib/assistantRuntime";
import { LlmClientError, type ChatRequestMessage, type LlmConfig } from "../lib/llmClient";
import type { WorkflowKind } from "../lib/workflows/types";
import type { ChatMessage } from "../types/chat";
import { withConversationArtifacts } from "../lib/conversationArtifacts";
import {
  disambiguationChoiceForText,
  confirmationControlForText,
  pendingDisambiguationFromMessages,
  pendingTaskFromMessages,
  withDisambiguationStatus,
  withPendingStatus,
  type ConfirmationControl,
} from "../lib/task/confirmation";
import { finalizeChatMessages, saveProjectChat } from "./projectArtifacts";

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
  sessions.delete(projectId);
  emit();
}

/** Abort an in-flight assistant turn for one project and finalize the pending reply. */
export function stopProjectAssistant(
  projectId: string,
  interruptedContent: string,
): boolean {
  if (!projectId.trim()) return false;
  const session = sessions.get(projectId);
  if (!session?.sending) return false;
  session.controller?.abort();
  session.controller = undefined;
  session.runId += 1;
  session.sending = false;
  session.messages = finalizeChatMessages(session.messages, interruptedContent);
  persistDurableChat(projectId, session.messages);
  emit();
  return true;
}

/** App is closing: stop runs and persist what we can (pending → interrupted via saveProjectChat). */
export function shutdownProjectChats(interruptedContent: string): void {
  for (const [projectId, session] of sessions) {
    session.controller?.abort();
    session.controller = undefined;
    session.runId += 1;
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
  confirmationControl?: { taskId: string; action: ConfirmationControl };
  disambiguationControl?: { taskId: string; choiceId?: string; action?: "cancel" };
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

  const activePending = pendingTaskFromMessages(session.messages);
  const activeDisambiguation = pendingDisambiguationFromMessages(session.messages);
  const inferredControl = request.confirmationControl?.action ?? confirmationControlForText(request.displayUserText);
  const inferredChoice = activeDisambiguation
    ? disambiguationChoiceForText(request.displayUserText, activeDisambiguation)
    : null;
  if (
    request.confirmationControl &&
    (!activePending || request.confirmationControl.taskId !== activePending.id)
  ) {
    // A stale card must never authorize, cancel, or supersede a newer task.
    return false;
  }
  if (
    request.disambiguationControl &&
    (!activeDisambiguation || request.disambiguationControl.taskId !== activeDisambiguation.id)
  ) {
    return false;
  }
  const resumeTask = activePending && inferredControl === "confirm" ? activePending : undefined;
  const cancelTask = activePending && inferredControl === "cancel" ? activePending : undefined;
  const selectedChoiceId = activeDisambiguation
    ? request.disambiguationControl?.choiceId ?? inferredChoice
    : null;
  const resumeDisambiguation = activeDisambiguation && selectedChoiceId
    ? { task: activeDisambiguation, choiceId: selectedChoiceId }
    : undefined;
  const cancelDisambiguation = activeDisambiguation && (
    request.disambiguationControl?.action === "cancel" ||
    inferredControl === "cancel"
  ) ? activeDisambiguation : undefined;

  if (activePending) {
    const status = resumeTask
      ? "confirmed"
      : cancelTask
        ? "cancelled"
        : "superseded";
    session.messages = withPendingStatus(session.messages, activePending.id, status);
  }
  if (!activePending && activeDisambiguation) {
    const status = resumeDisambiguation
      ? "selected"
      : cancelDisambiguation
        ? "cancelled"
        : "superseded";
    session.messages = withDisambiguationStatus(session.messages, activeDisambiguation.id, status);
  }

  const userMessage: ChatMessage = withConversationArtifacts({
    id: crypto.randomUUID(),
    role: "user",
    content: request.displayUserText,
  });

  if (cancelTask) {
    session.messages = [
      ...session.messages,
      userMessage,
      withConversationArtifacts({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "已取消待处理的文件修改；项目文件没有变化。",
        execution: {
          schemaVersion: "1",
          outcome: "answer",
          taskSource: "resumed",
          action: cancelTask.spec.action,
          targetCount: cancelTask.targets.length,
        },
      }),
    ];
    persistDurableChat(projectId, session.messages);
    emit();
    return true;
  }
  if (cancelDisambiguation) {
    session.messages = [
      ...session.messages,
      userMessage,
      withConversationArtifacts({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Target selection cancelled; project files were not changed.",
        execution: {
          schemaVersion: "1",
          outcome: "answer",
          taskSource: "resumed",
          action: cancelDisambiguation.spec.action,
          targetCount: cancelDisambiguation.choices.length,
        },
      }),
    ];
    persistDurableChat(projectId, session.messages);
    emit();
    return true;
  }
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
      conversation: session.messages.filter((message) => message.id !== thinkingId),
      workflow: request.workflow,
      ctx: request.ctx,
      signal: controller.signal,
      ...(resumeTask ? { resumeTask } : {}),
      ...(resumeDisambiguation ? { resumeDisambiguation } : {}),
      onDelta: (delta) => {
        if (!stillThisRun()) return;
        streamed += delta;
        const current = ensure(projectId);
        current.messages = current.messages.map((message) =>
          message.id === thinkingId
            ? { ...message, content: streamed, pending: true }
            : message,
        );
        emit();
      },
    });

    if (!stillThisRun()) return false;

    await request.onComplete?.(result);

    if (!stillThisRun()) return false;

    const primarySuggestion = result.suggestions[0];
    const extra = result.suggestions.slice(1).map((suggestion) => withConversationArtifacts({
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: suggestion.title || "Additional suggestion",
      suggestion,
    }));
    const current = ensure(projectId);
    if (resumeTask && result.outcome === "blocked") {
      current.messages = withPendingStatus(current.messages, resumeTask.id, "expired");
    }
    if (resumeDisambiguation && result.outcome === "blocked") {
      current.messages = withDisambiguationStatus(current.messages, resumeDisambiguation.task.id, "expired");
    }
    current.messages = [
      ...current.messages.map((message) =>
        message.id === thinkingId
          ? withConversationArtifacts({
              id: message.id,
              role: message.role,
              content: result.content,
              suggestion: primarySuggestion,
              ...(result.confirmation
                ? { confirmation: { task: result.confirmation, status: result.confirmation.status } }
                : {}),
              ...(result.disambiguation
                ? { disambiguation: { task: result.disambiguation, status: result.disambiguation.status } }
                : {}),
              execution: result.execution,
            })
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
    if (resumeTask) {
      current.messages = withPendingStatus(current.messages, resumeTask.id, "awaiting-confirmation");
    }
    if (resumeDisambiguation) {
      current.messages = withDisambiguationStatus(current.messages, resumeDisambiguation.task.id, "awaiting-disambiguation");
    }
    current.messages = current.messages.map((message) =>
      message.id === thinkingId
        ? withConversationArtifacts({
            id: message.id,
            role: message.role,
            content: request.mapError(error),
          })
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
      current.sending = false;
      if (current.controller === controller) current.controller = undefined;
      emit();
    }
  }
}
