import type {
  ChatRequestMessage,
  LlmConfig,
} from "./llmClient";
import {
  applyRuntimeScaffoldGuard,
  detectSkillIntent,
  routeWorkflow,
  type SkillIntent,
  type WorkflowRoute,
} from "./skillRouter";
import { classifyWorkflowKind } from "./workflowClassifier";
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
  /** Incremental token callback for streaming UI. */
  onDelta?: (delta: string) => void;
  /** Cancel in-flight model calls when the user switches project or leaves. */
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

function workflowRequestFromRuntime(
  req: RuntimeRequest,
  route: WorkflowRoute,
): WorkflowRequest {
  const selectionTarget =
    !route.plan.target &&
    req.ctx.selection &&
    (route.kind === "writing" || route.kind === "polish")
      ? { kind: "selection" as const }
      : undefined;
  const plan = {
    ...route.plan,
    ...(selectionTarget ? { target: selectionTarget } : {}),
  };

  return {
    kind: route.kind,
    userText: req.userText,
    ...(req.ctx.activeFile ? { activeFile: req.ctx.activeFile } : {}),
    ...(req.ctx.selectedText !== undefined ? { selectedText: req.ctx.selectedText } : {}),
    ...(req.ctx.selection ? { selection: { ...req.ctx.selection } } : {}),
    ...(req.ctx.mainFile ? { mainFile: req.ctx.mainFile } : {}),
    ...(req.ctx.lastCompileLog ? { lastCompileLog: req.ctx.lastCompileLog } : {}),
    ...(route.reviseProse ? { reviseProse: true } : {}),
    plan,
  };
}

export async function runAssistant(req: RuntimeRequest): Promise<RuntimeResult> {
  const explicitWorkflow = req.workflow && req.workflow !== "auto"
    ? req.workflow
    : req.mode === "review"
      ? "review"
      : undefined;
  let route = routeWorkflow({
    text: req.userText,
    ...(explicitWorkflow ? { explicitWorkflow } : {}),
    ...(req.intent !== undefined ? { legacyIntent: req.intent } : {}),
  });
  const routeLocked = route.source === "ui" || route.source === "command";
  let routeNote = `route:${route.source}:${route.kind}`;

  if (route.needsLlmClassification) {
    const classified = await classifyWorkflowKind({
      config: req.config,
      userText: req.userText,
      history: req.history,
      ...(req.signal ? { signal: req.signal } : {}),
    });
    route = routeWorkflow({
      text: req.userText,
      explicitWorkflow: classified.kind,
    });
    routeNote = `route:llm:${classified.kind}:${classified.source}`;
  }

  // Classifier may label blank-shell prep as advice/polish; runtime still owns scaffolding.
  const guarded = applyRuntimeScaffoldGuard({
    route,
    userText: req.userText,
    locked: routeLocked,
  });
  route = guarded.route;
  if (guarded.overridden) {
    routeNote = `${routeNote}+runtime:scaffold(from:${guarded.fromKind})`;
  }

  const result = await executeWorkflow({
    request: workflowRequestFromRuntime(req, route),
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
      routeNote,
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

/** Legacy helper: natural language no longer binds a final kind without classification. */
export function detectWorkflow(text: string): WorkflowKind {
  return routeWorkflow({ text }).kind;
}
