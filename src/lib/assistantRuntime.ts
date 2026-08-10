import type {
  ChatRequestMessage,
  LlmConfig,
} from "./llmClient";
import {
  detectSkillIntent,
  routeWorkflow,
  type SkillIntent,
} from "./skillRouter";
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
  /** Preferred Plan07 explicit UI action. */
  workflow?: "auto" | WorkflowKind;
  /** Deprecated compatibility input; mapped to a WorkflowKind by the router. */
  intent?: "auto" | SkillIntent | "general";
};

export type RuntimeResult = {
  /** Validated typed workflow result; UI may progressively render report/evidence panels. */
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
  kind: WorkflowKind,
  reviseProse: boolean,
): WorkflowRequest {
  return {
    kind,
    userText: req.userText,
    ...(req.ctx.activeFile ? { activeFile: req.ctx.activeFile } : {}),
    ...(req.ctx.selectedText !== undefined ? { selectedText: req.ctx.selectedText } : {}),
    ...(req.ctx.selection ? { selection: { ...req.ctx.selection } } : {}),
    ...(req.ctx.mainFile ? { mainFile: req.ctx.mainFile } : {}),
    ...(req.ctx.lastCompileLog ? { lastCompileLog: req.ctx.lastCompileLog } : {}),
    ...(reviseProse ? { reviseProse: true } : {}),
  };
}

export async function runAssistant(req: RuntimeRequest): Promise<RuntimeResult> {
  const explicitWorkflow = req.workflow && req.workflow !== "auto"
    ? req.workflow
    : req.mode === "review"
      ? "review"
      : undefined;
  const route = routeWorkflow({
    text: req.userText,
    explicitWorkflow,
    legacyIntent: req.intent,
  });
  const result = await executeWorkflow({
    request: workflowRequestFromRuntime(req, route.kind, route.reviseProse),
    config: req.config,
    history: req.history,
    ctx: req.ctx,
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
      `route:${route.source}:${route.kind}`,
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
