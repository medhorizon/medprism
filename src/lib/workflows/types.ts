import type { ChatRequestMessage, LlmConfig } from "../llmClient";
import type { PatchSet } from "../patch/schema";
import type { ToolContext, ToolResult } from "../../tools/types";

export type WorkflowKind =
  | "writing"
  | "polish"
  | "citation"
  | "latex"
  | "compile-fix"
  | "review";

export type WorkflowRequest = {
  kind: WorkflowKind;
  userText: string;
  activeFile?: string;
  selectedText?: string;
  selection?: {
    start: number;
    end: number;
  };
  mainFile?: string;
  lastCompileLog?: string;
  /** Router-owned option for requests such as “polish and add citations”. */
  reviseProse?: boolean;
};

export type CitationRelation =
  | "supports"
  | "contradicts"
  | "related"
  | "topic_match_only";

export type CitationJudgement = {
  candidateId: string;
  relation: CitationRelation;
  selected: boolean;
  reason: string;
};

export type CitationPlan = {
  schemaVersion: "1";
  claim: string;
  targetPath: string;
  candidates: CitationJudgement[];
  warnings: string[];
};

export type ReviewSeverity = "major" | "moderate" | "minor";

export type ReviewCategory =
  | "scientific"
  | "statistics"
  | "evidence"
  | "consistency"
  | "writing"
  | "latex";

export type ReviewFinding = {
  severity: ReviewSeverity;
  category: ReviewCategory;
  location?: {
    path?: string;
    text?: string;
  };
  issue: string;
  whyItMatters: string;
  recommendation: string;
  canApplyAsEdit: boolean;
};

export type ReviewCoverage = {
  filesRead: string[];
  filesNotRead: string[];
  limitations: string[];
};

export type ReviewReport = {
  schemaVersion: "1";
  summary: string;
  warnings: string[];
  coverage: ReviewCoverage;
  findings: ReviewFinding[];
};

/** Runtime-owned result. Model output never supplies a hydrated PatchSet. */
export type AgentResult = {
  schemaVersion: "1";
  workflow: WorkflowKind;
  summary: string;
  warnings: string[];
  patch?: PatchSet;
  citationPlan?: CitationPlan;
  review?: ReviewReport;
};

export type WorkflowResult = {
  agent: AgentResult;
  content: string;
  toolNotes: string[];
  lastCompileLog?: string;
  pdfBase64?: string;
};

export type ModelCompletionRequest = {
  config: LlmConfig;
  messages: ChatRequestMessage[];
  signal?: AbortSignal;
};

export type WorkflowServices = {
  complete: (request: ModelCompletionRequest) => Promise<string>;
  runTool: (
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
};

export type WorkflowExecutionInput = {
  request: WorkflowRequest;
  config: LlmConfig;
  history: ChatRequestMessage[];
  ctx: ToolContext;
  services: WorkflowServices;
};

export type WorkflowHandler = (
  input: WorkflowExecutionInput,
) => Promise<WorkflowResult>;

export function emptyAgentResult(
  workflow: WorkflowKind,
  summary: string,
  warnings: string[] = [],
): AgentResult {
  return {
    schemaVersion: "1",
    workflow,
    summary,
    warnings,
  };
}
