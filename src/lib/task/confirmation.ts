import type { ResolvedTask } from "../context/resolver";
import { artifactTextHash, validateConversationArtifact } from "../conversationArtifacts";
import { displayHeading } from "../manuscript/slots";
import type { SuccessfulInterpretedTask } from "./types";
import type {
  ChatMessage,
  PendingDisambiguationTask,
  PendingDisambiguationTaskStatus,
  PendingFileTask,
  PendingFileTaskStatus,
} from "../../types/chat";

export type ConfirmationControl = "confirm" | "cancel";

const CONFIRM_RE = /^(?:确认|继续|确定|同意|执行|可以|好的?|好，?继续|confirm|continue|proceed|yes|ok(?:ay)?)\s*[。.!！]?$/i;
const CANCEL_RE = /^(?:取消|不要|停止|算了|不修改|cancel|stop|no)\s*[。.!！]?$/i;

export function confirmationControlForText(text: string): ConfirmationControl | null {
  const normalized = text.trim();
  if (CONFIRM_RE.test(normalized)) return "confirm";
  if (CANCEL_RE.test(normalized)) return "cancel";
  return null;
}

function operationFor(resolved: ResolvedTask): PendingFileTask["targets"][number]["operation"] {
  if (resolved.spec.action === "draft") return "generate";
  if (resolved.spec.action === "scaffold") return "scaffold";
  if (resolved.spec.action === "cite") return "cite";
  if (resolved.spec.action === "compile-fix") return "repair";
  return resolved.targets.some((target) => target.occurrence) ? "replace" : "insert";
}

export function buildPendingFileTask(resolved: ResolvedTask): PendingFileTask {
  const sourceIds = new Set(resolved.spec.targets.flatMap((target) => target.sourceIds));
  const interpretedSources = resolved.sourceArtifacts.filter((source) => sourceIds.has(source.id));
  const operation = operationFor(resolved);
  const targetSelections = resolved.targets
    .filter((target) => target.lockedToOccurrence && target.targetIndex !== undefined && target.occurrence)
    .map((target) => ({
      targetIndex: target.targetIndex!,
      occurrenceId: target.occurrence!.id,
    }));
  return {
    schemaVersion: "1",
    id: crypto.randomUUID(),
    projectId: resolved.projectId,
    projectRevision: resolved.model.projectRevision,
    createdAt: new Date().toISOString(),
    status: "awaiting-confirmation",
    spec: resolved.spec,
    sources: interpretedSources,
    ...(targetSelections.length ? { targetSelections } : {}),
    targets: resolved.targets.map((target) => ({
      id: target.id,
      slot: displayHeading(target.ref),
      ...(target.occurrence?.path || target.insertion?.path
        ? { path: target.occurrence?.path ?? target.insertion?.path }
        : {}),
      operation,
      ...(target.providedText
        ? { preview: target.providedText.slice(0, 400) }
        : {}),
    })),
    ...(resolved.selection
      ? {
          selection: {
            path: resolved.selection.path,
            start: resolved.selection.range.start,
            end: resolved.selection.range.end,
            textHash: artifactTextHash(resolved.selection.text),
          },
        }
      : {}),
  };
}

export function buildPendingDisambiguationTask(
  resolved: ResolvedTask,
  args: {
    taskSource: PendingDisambiguationTask["taskSource"];
    repaired: boolean;
    explicitlyAuthorized: boolean;
  },
): PendingDisambiguationTask {
  const sourceIds = new Set(resolved.spec.targets.flatMap((target) => target.sourceIds));
  const interpretedSources = resolved.sourceArtifacts.filter((source) => sourceIds.has(source.id));
  return {
    schemaVersion: "1",
    id: crypto.randomUUID(),
    projectId: resolved.projectId,
    projectRevision: resolved.model.projectRevision,
    createdAt: new Date().toISOString(),
    status: "awaiting-disambiguation",
    spec: resolved.spec,
    sources: interpretedSources,
    taskSource: args.taskSource,
    repaired: args.repaired,
    explicitlyAuthorized: args.explicitlyAuthorized,
    choices: resolved.ambiguities.flatMap((ambiguity) =>
      ambiguity.choices.map((occurrence, index) => ({
        id: `choice:${ambiguity.targetIndex}:${index}:${occurrence.id}`,
        targetIndex: ambiguity.targetIndex,
        occurrenceId: occurrence.id,
        slot: displayHeading(ambiguity.ref),
        path: occurrence.path,
        syntax: occurrence.syntax,
        heading: occurrence.heading,
        ...(occurrence.body.trim()
          ? { preview: occurrence.body.trim().replace(/\s+/g, " ").slice(0, 220) }
          : {}),
      })),
    ),
    ...(resolved.selection
      ? {
          selection: {
            path: resolved.selection.path,
            start: resolved.selection.range.start,
            end: resolved.selection.range.end,
            textHash: artifactTextHash(resolved.selection.text),
          },
        }
      : {}),
  };
}

export function pendingTaskFromMessages(messages: readonly ChatMessage[]): PendingFileTask | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const confirmation = messages[index]?.confirmation;
    if (confirmation?.status === "awaiting-confirmation") return confirmation.task;
  }
  return null;
}

export function pendingDisambiguationFromMessages(messages: readonly ChatMessage[]): PendingDisambiguationTask | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const disambiguation = messages[index]?.disambiguation;
    if (disambiguation?.status === "awaiting-disambiguation") return disambiguation.task;
  }
  return null;
}

export function withPendingStatus(
  messages: readonly ChatMessage[],
  taskId: string,
  status: PendingFileTaskStatus,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.confirmation?.task.id !== taskId) return { ...message };
    return {
      ...message,
      confirmation: {
        task: { ...message.confirmation.task, status },
        status,
      },
    };
  });
}

export function withDisambiguationStatus(
  messages: readonly ChatMessage[],
  taskId: string,
  status: PendingDisambiguationTaskStatus,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.disambiguation?.task.id !== taskId) return { ...message };
    return {
      ...message,
      disambiguation: {
        task: { ...message.disambiguation.task, status },
        status,
      },
    };
  });
}

export function disambiguationChoiceForText(
  text: string,
  task: PendingDisambiguationTask,
): string | null {
  const normalized = text.trim();
  if (!normalized) return null;
  const direct = task.choices.find((choice) =>
    normalized === choice.id ||
    normalized === choice.path ||
    normalized === `${choice.slot} ${choice.path}` ||
    normalized === `${choice.slot} · ${choice.path}`,
  );
  if (direct) return direct.id;
  const numeric = normalized.match(/^(?:#?\s*|option\s+|choice\s+|select\s+|target\s+)?(\d{1,2})(?:\s*(?:st|nd|rd|th)?|[.。])?$/i)?.[1] ??
    normalized.match(/^第\s*(\d{1,2})\s*(?:个|项|处)?$/)?.[1];
  if (!numeric) return null;
  const index = Number(numeric) - 1;
  return task.choices[index]?.id ?? null;
}

export function interpretedFromPending(task: PendingFileTask): SuccessfulInterpretedTask | null {
  if (task.status !== "awaiting-confirmation") return null;
  if (task.sources.some((source) => !validateConversationArtifact(source))) return null;
  return {
    ok: true,
    spec: task.spec,
    sources: task.sources,
    source: "locked",
    repaired: false,
    ...(task.targetSelections?.length ? { targetSelections: task.targetSelections } : {}),
  };
}

export function interpretedFromDisambiguationChoice(
  task: PendingDisambiguationTask,
  choiceId: string,
): SuccessfulInterpretedTask | null {
  if (task.status !== "awaiting-disambiguation") return null;
  if (task.sources.some((source) => !validateConversationArtifact(source))) return null;
  const choice = task.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) return null;
  return {
    ok: true,
    spec: task.spec,
    sources: task.sources,
    source: task.taskSource,
    repaired: task.repaired,
    targetSelections: [{
      targetIndex: choice.targetIndex,
      occurrenceId: choice.occurrenceId,
    }],
  };
}
