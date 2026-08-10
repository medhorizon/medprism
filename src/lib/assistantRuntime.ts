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
import type { TaskAction } from "./task/types";
import type { LatexTargetSpec } from "./latex/types";
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
import type { ChatMessage, ChatSuggestion } from "../types/chat";

ensureToolsRegistered();

export type RuntimeRequest = {
  mode: AssistantMode;
  config: LlmConfig;
  userText: string;
  history: ChatRequestMessage[];
  ctx: ToolContext;
  /** Preferred explicit UI action. */
  workflow?: "auto" | WorkflowKind;
  /** Deprecated compatibility input; mapped to a WorkflowKind by the router. */
  intent?: "auto" | SkillIntent | "general";
  /** Incremental text callback for the active project chat session. */
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
};

export type RuntimeResult = {
  agent: AgentResult;
  content: string;
  suggestions: NonNullable<ChatMessage["suggestion"]>[];
  toolNotes: string[];
  lastCompileLog?: string;
  pdfBase64?: string;
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

function legacyTarget(resolved: ResolvedTask): LatexTargetSpec | undefined {
  if (resolved.selection) return { kind: "selection", createIfMissing: false };
  const ref = resolved.targets[0]?.ref;
  if (!ref) return undefined;
  if (ref.slot === "custom-section") {
    return { kind: "section", sectionTitle: ref.title, createIfMissing: true };
  }
  const direct = new Set<LatexTargetSpec["kind"]>([
    "title", "abstract", "keywords", "introduction", "methods", "results",
    "discussion", "conclusion", "acknowledgements", "funding",
    "author-contributions", "data-availability", "ethics", "body",
  ]);
  if (direct.has(ref.slot as LatexTargetSpec["kind"])) {
    return { kind: ref.slot as LatexTargetSpec["kind"], createIfMissing: true };
  }
  if (ref.slot === "competing-interests") {
    return { kind: "conflict-of-interest", createIfMissing: true };
  }
  return { kind: "section", sectionTitle: resolved.targets[0]?.occurrence?.heading ?? ref.slot, createIfMissing: true };
}

function workflowRequestFromTask(
  req: RuntimeRequest,
  resolved: ResolvedTask,
): WorkflowRequest {
  const kind = workflowForAction(resolved.spec.action);
  const applyToLatex = !["advice", "review", "research"].includes(kind);
  const target = legacyTarget(resolved);
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
      ...(target ? { target } : {}),
      applyToLatex,
    },
    resolvedTask: resolved,
  };
}

export async function runAssistant(req: RuntimeRequest): Promise<RuntimeResult> {
  const explicitWorkflow = req.workflow && req.workflow !== "auto"
    ? req.workflow
    : req.mode === "review"
      ? "review"
      : undefined;
  const explicitAction = explicitWorkflow ? actionForWorkflow(explicitWorkflow) : undefined;
  const lockedAction = lockedTaskAction({
    userText: req.userText,
    ...(explicitAction ? { explicitAction } : {}),
  });
  const snapshot = await buildContextSnapshot(req.ctx);
  const model = buildManuscriptModel(snapshot);
  const interpreted = await interpretTaskSpec({
    config: req.config,
    userText: req.userText,
    history: req.history,
    model,
    ...(lockedAction ? { lockedAction } : {}),
    ...(req.signal ? { signal: req.signal } : {}),
  });
  const resolved = resolveTaskContext({ snapshot, model, interpreted });
  const result = await executeWorkflow({
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

  return {
    agent: result.agent,
    content: result.content,
    suggestions,
    toolNotes: [
      ...result.toolNotes,
      `task-route:${interpreted.source}:${resolved.spec.action}`,
    ],
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
