import type {
  ChatRequestMessage,
  LlmConfig,
} from "./llmClient";
import {
  detectSkillIntent,
  routeWorkflow,
  type SkillIntent,
} from "./skillRouter";
import { buildContextSnapshot } from "./context/snapshot";
import { resolveTaskContext, type ResolvedTask } from "./context/resolver";
import { buildManuscriptModel } from "./manuscript/model";
import { interpretTaskSpec, lockedTaskAction } from "./task/interpreter";
import {
  buildPendingDisambiguationTask,
  buildPendingFileTask,
  interpretedFromDisambiguationChoice,
  interpretedFromPending,
} from "./task/confirmation";
import { artifactTextHash, conversationArtifacts } from "./conversationArtifacts";
import type { TaskAction } from "./task/types";
import { enrichSuggestion } from "./suggestions";
import { executeWorkflow } from "./workflows/executor";
import type {
  AgentResult,
  WorkflowKind,
  WorkflowRequest,
} from "./workflows/types";
import {
  ensureToolsRegistered,
  type AssistantMode,
  type ToolContext,
} from "../tools";
import type {
  AssistantOutcomeKind,
  ChatExecution,
  ChatMessage,
  ChatSuggestion,
  PendingDisambiguationTask,
  PendingFileTask,
} from "../types/chat";

ensureToolsRegistered();

export type RuntimeRequest = {
  mode: AssistantMode;
  config: LlmConfig;
  userText: string;
  history: ChatRequestMessage[];
  conversation: ChatMessage[];
  ctx: ToolContext;
  /** Preferred explicit UI action. */
  workflow?: "auto" | WorkflowKind;
  /** Deprecated compatibility input; mapped to a WorkflowKind by the router. */
  intent?: "auto" | SkillIntent | "general";
  /** Incremental text callback for the active project chat session. */
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
  /** Trusted confirmation state; when present the interpreter is not called again. */
  resumeTask?: PendingFileTask;
  /** Trusted target choice state; when present the interpreter is not called again. */
  resumeDisambiguation?: { task: PendingDisambiguationTask; choiceId: string };
};

export type RuntimeResult = {
  agent: AgentResult;
  content: string;
  suggestions: NonNullable<ChatMessage["suggestion"]>[];
  toolNotes: string[];
  outcome: AssistantOutcomeKind;
  execution: ChatExecution;
  disambiguation?: PendingDisambiguationTask;
  confirmation?: PendingFileTask;
  lastCompileLog?: string;
  pdfBase64?: string;
};

export type AssistantRuntimeDependencies = {
  interpret: typeof interpretTaskSpec;
  execute: typeof executeWorkflow;
};

function asSuggestion(patchSet: NonNullable<ChatSuggestion["patchSet"]>): ChatSuggestion {
  return {
    title: patchSet.summary,
    body: patchSet.summary,
    path: patchSet.operations[0]?.path,
    patchSet,
    status: "pending",
  };
}

function actionForWorkflow(workflow: WorkflowKind): TaskAction {
  const map: Record<WorkflowKind, TaskAction> = {
    research: "research",
    writing: "draft",
    polish: "polish",
    citation: "cite",
    latex: "latex",
    "compile-fix": "compile-fix",
    review: "review",
    advice: "advice",
  };
  return map[workflow];
}

function workflowForAction(action: TaskAction): WorkflowKind {
  if (action === "advice") return "advice";
  if (action === "polish") return "polish";
  if (action === "cite") return "citation";
  if (action === "review") return "review";
  if (action === "research") return "research";
  if (action === "latex") return "latex";
  if (action === "compile-fix") return "compile-fix";
  return "writing";
}

function workflowForResolvedTask(resolved: ResolvedTask): WorkflowKind {
  if (
    resolved.spec.applyMode === "answer-only" &&
    (resolved.spec.action === "draft" || resolved.spec.action === "polish")
  ) {
    return "advice";
  }
  return workflowForAction(resolved.spec.action);
}

function workflowRequestFromTask(
  req: RuntimeRequest,
  resolved: ResolvedTask,
): WorkflowRequest {
  const kind = workflowForResolvedTask(resolved);
  const applyToLatex = resolved.spec.applyMode === "propose-patch";
  return {
    kind,
    userText: req.userText,
    ...(req.ctx.activeFile ? { activeFile: req.ctx.activeFile } : {}),
    ...(req.ctx.selectedText !== undefined ? { selectedText: req.ctx.selectedText } : {}),
    ...(req.ctx.selection ? { selection: { ...req.ctx.selection } } : {}),
    ...(req.ctx.mainFile ? { mainFile: req.ctx.mainFile } : {}),
    ...(req.ctx.lastCompileLog ? { lastCompileLog: req.ctx.lastCompileLog } : {}),
    plan: {
      primary: kind,
      steps: applyToLatex ? [kind, "latex-apply"] : [kind],
      applyToLatex,
    },
    resolvedTask: resolved,
  };
}

function blockedResult(args: {
  message: string;
  source: ChatExecution["taskSource"];
  action?: TaskAction;
  targetCount?: number;
  failureCode: string;
  notes?: string[];
}): RuntimeResult {
  const execution: ChatExecution = {
    schemaVersion: "1",
    outcome: "blocked",
    taskSource: args.source,
    ...(args.action ? { action: args.action } : {}),
    targetCount: args.targetCount ?? 0,
    failureCode: args.failureCode,
  };
  return {
    agent: {
      schemaVersion: "1",
      workflow: args.action ? workflowForAction(args.action) : "advice",
      summary: "File transaction blocked",
      warnings: [args.message],
    },
    content: `未修改项目文件：${args.message}`,
    suggestions: [],
    toolNotes: [...(args.notes ?? []), `outcome:blocked:${args.failureCode}`],
    outcome: "blocked",
    execution,
  };
}

function confirmationText(task: PendingFileTask): string {
  const targets = task.targets.map((target) => `${target.slot}${target.path ? `（${target.path}）` : ""}`).join("、");
  const preview = task.targets.map((target) => target.preview).find(Boolean);
  return `检测到文件修改请求，将处理：${targets || "当前选区"}。${preview ? `\n\n内容预览：${preview}` : ""}\n\n请确认是否继续生成 Diff/Keep；此时尚未修改项目文件。`;
}

function disambiguationText(task: PendingDisambiguationTask): string {
  const choices = task.choices
    .map((choice, index) => `${index + 1}. ${choice.slot} · ${choice.path}${choice.preview ? `\n   ${choice.preview}` : ""}`)
    .join("\n");
  return `Multiple possible manuscript targets were found. Choose the exact target before MedPrism prepares Diff/Keep.\n\n${choices}`;
}

export async function runAssistant(
  req: RuntimeRequest,
  dependencies: Partial<AssistantRuntimeDependencies> = {},
): Promise<RuntimeResult> {
  const interpret = dependencies.interpret ?? interpretTaskSpec;
  const execute = dependencies.execute ?? executeWorkflow;
  const explicitWorkflow = req.workflow && req.workflow !== "auto"
    ? req.workflow
    : req.mode === "review"
      ? "review"
      : undefined;
  const snapshot = await buildContextSnapshot(req.ctx);
  const model = buildManuscriptModel(snapshot);
  const explicitAction = explicitWorkflow ? actionForWorkflow(explicitWorkflow) : undefined;
  const lockedAction = lockedTaskAction({ userText: req.userText, ...(explicitAction ? { explicitAction } : {}) });
  const resumed = req.resumeTask;
  const resumedDisambiguation = req.resumeDisambiguation;
  const interpreted = resumed
    ? interpretedFromPending(resumed)
    : resumedDisambiguation
      ? interpretedFromDisambiguationChoice(resumedDisambiguation.task, resumedDisambiguation.choiceId)
    : await interpret({
        config: req.config,
        userText: req.userText,
        history: req.history,
        model,
        sources: conversationArtifacts(req.conversation),
        selectionAvailable: Boolean(snapshot.selection),
        ...(lockedAction ? { lockedAction } : {}),
        ...(req.signal ? { signal: req.signal } : {}),
      });
  if (!interpreted) {
    return blockedResult({ message: "待确认任务不存在、已失效或内容校验失败。", source: "resumed", failureCode: "PENDING_TASK_INVALID" });
  }
  if (!interpreted.ok) {
    return blockedResult({ message: interpreted.error, source: "invalid", failureCode: "TASKSPEC_INVALID" });
  }
  if (resumed && resumed.projectId !== snapshot.projectId) {
    return blockedResult({ message: "待确认任务属于另一个项目。", source: "resumed", action: interpreted.spec.action, failureCode: "PROJECT_MISMATCH" });
  }
  if (resumedDisambiguation && resumedDisambiguation.task.projectId !== snapshot.projectId) {
    return blockedResult({ message: "Pending target choice belongs to another project.", source: "resumed", action: interpreted.spec.action, failureCode: "PROJECT_MISMATCH" });
  }
  const resumedSelection = resumed?.selection ?? resumedDisambiguation?.task.selection;
  if (resumedSelection) {
    const current = snapshot.selection && snapshot.selectedText !== undefined
      ? {
          path: snapshot.activeFile,
          start: snapshot.selection.start,
          end: snapshot.selection.end,
          textHash: artifactTextHash(snapshot.selectedText),
        }
      : null;
    if (
      !current ||
      current.path !== resumedSelection.path ||
      current.start !== resumedSelection.start ||
      current.end !== resumedSelection.end ||
      current.textHash !== resumedSelection.textHash
    ) {
      return blockedResult({ message: "编辑器选区已变化，请重新发起修改。", source: "resumed", action: interpreted.spec.action, failureCode: "SELECTION_STALE" });
    }
  }
  const resolved = resolveTaskContext({ snapshot, model, interpreted });
  if (resolved.errors.length > 0) {
    return blockedResult({
      message: resolved.errors.join(" "),
      source: resumed || resumedDisambiguation ? "resumed" : interpreted.source,
      action: interpreted.spec.action,
      targetCount: resolved.targets.length,
      failureCode: "CONTEXT_UNRESOLVED",
      notes: resolved.toolNotes,
    });
  }
  if (resolved.ambiguities.length > 0) {
    const disambiguation = buildPendingDisambiguationTask(resolved, {
      taskSource: interpreted.source,
      repaired: interpreted.repaired,
      explicitlyAuthorized: Boolean(lockedAction || resumedDisambiguation?.task.explicitlyAuthorized),
    });
    const execution: ChatExecution = {
      schemaVersion: "1",
      outcome: "disambiguation-required",
      taskSource: interpreted.source,
      action: resolved.spec.action,
      targetCount: disambiguation.choices.length,
    };
    return {
      agent: {
        schemaVersion: "1",
        workflow: workflowForAction(resolved.spec.action),
        summary: "Waiting for target selection",
        warnings: resolved.warnings,
      },
      content: disambiguationText(disambiguation),
      suggestions: [],
      toolNotes: [...resolved.toolNotes, "outcome:disambiguation-required"],
      outcome: "disambiguation-required",
      execution,
      disambiguation,
    };
  }
  const bypassConfirmation = Boolean(resumed || lockedAction || resumedDisambiguation?.task.explicitlyAuthorized);
  if (resolved.spec.applyMode === "propose-patch" && !bypassConfirmation) {
    const confirmation = buildPendingFileTask(resolved);
    const execution: ChatExecution = {
      schemaVersion: "1",
      outcome: "confirmation-required",
      taskSource: interpreted.source,
      action: resolved.spec.action,
      targetCount: resolved.targets.length,
    };
    return {
      agent: {
        schemaVersion: "1",
        workflow: workflowForAction(resolved.spec.action),
        summary: "Waiting for file transaction confirmation",
        warnings: resolved.warnings,
      },
      content: confirmationText(confirmation),
      suggestions: [],
      toolNotes: [...resolved.toolNotes, "outcome:confirmation-required"],
      outcome: "confirmation-required",
      execution,
      confirmation,
    };
  }
  const result = await execute({
    request: workflowRequestFromTask(req, resolved),
    config: req.config,
    history: req.history,
    ctx: req.ctx,
    ...(req.onDelta ? { onDelta: req.onDelta } : {}),
    ...(req.signal ? { signal: req.signal } : {}),
  });

  const suggestions: ChatSuggestion[] = [];
  if (result.agent.patch) {
    suggestions.push(
      await enrichSuggestion(asSuggestion(result.agent.patch), req.ctx.files),
    );
  }

  if (resolved.spec.applyMode === "propose-patch" && !result.agent.patch) {
    return blockedResult({
      message: result.agent.warnings.join(" ") || result.content || "修改工作流没有生成可验证的 PatchSet。",
      source: resumed || resumedDisambiguation ? "resumed" : interpreted.source,
      action: resolved.spec.action,
      targetCount: resolved.targets.length,
      failureCode: "PATCH_NOT_PRODUCED",
      notes: [...resolved.toolNotes, ...result.toolNotes],
    });
  }
  if (resolved.spec.applyMode === "answer-only" && result.agent.patch) {
    return blockedResult({
      message: "answer-only 任务意外返回了文件修改。",
      source: interpreted.source,
      action: resolved.spec.action,
      targetCount: resolved.targets.length,
      failureCode: "UNEXPECTED_PATCH",
    });
  }

  const outcome: AssistantOutcomeKind = result.agent.patch ? "patch-proposed" : "answer";
  const execution: ChatExecution = {
    schemaVersion: "1",
    outcome,
    taskSource: resumed || resumedDisambiguation ? "resumed" : interpreted.source,
    action: resolved.spec.action,
    targetCount: resolved.targets.length,
  };

  return {
    agent: result.agent,
    content: result.agent.patch
      ? `已准备好文件修改，尚未应用。请检查下方 Diff 后选择 Keep。`
      : result.content,
    suggestions,
    toolNotes: [
      ...result.toolNotes,
      `task-route:${interpreted.source}:${resolved.spec.action}`,
      `outcome:${outcome}`,
    ],
    outcome,
    execution,
    ...(result.lastCompileLog !== undefined
      ? { lastCompileLog: result.lastCompileLog }
      : {}),
    ...(result.pdfBase64 ? { pdfBase64: result.pdfBase64 } : {}),
  };
}

/** Legacy compatibility API. New callers should use detectWorkflow(). */
export function detectIntent(text: string): SkillIntent {
  return detectSkillIntent(text);
}

export function detectWorkflow(text: string): WorkflowKind {
  return routeWorkflow({ text }).kind;
}
