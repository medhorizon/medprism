import type { ChatRequestMessage, LlmConfig } from "../llmClient";
import type { LatexDraftFormat, LatexTargetSpec } from "../latex/types";
import type { PatchSet } from "../patch/schema";
import type {
  ResearchBundle,
  ResearchReport,
  ResearchSpec,
} from "../research/types";
import type { ToolContext, ToolResult } from "../../tools/types";
import type { ContextPackage } from "../context/snapshot";

export type WorkflowKind =
  | "research"
  | "writing"
  | "polish"
  | "citation"
  | "latex"
  | "compile-fix"
  | "review"
  | "advice";

/** A visible, linear runtime stage. `latex-apply` is trusted code, not an agent. */
export type WorkflowStageKind = WorkflowKind | "latex-apply";

/** A deliberately linear, deterministic plan. It is not a general DAG. */
export type WorkflowPlan = {
  primary: WorkflowKind;
  steps: WorkflowStageKind[];
  /** Optional reusable literature-retrieval stage, executed before primary. */
  research?: ResearchSpec;
  /** Runtime-owned LaTeX destination for text-producing workflows. */
  target?: LatexTargetSpec;
  /** Whether the primary workflow may produce a file PatchSet. */
  applyToLatex: boolean;
};

export type WorkflowRequest = {
  kind: WorkflowKind;
  userText: string;
  activeFile?: string;
  selectedText?: string;
  selection?: { start: number; end: number };
  mainFile?: string;
  lastCompileLog?: string;
  /** Router-owned option for requests such as “polish and add citations”. */
  reviseProse?: boolean;
  /** Ordered runtime plan. Older callers may omit it; executor creates a safe default. */
  plan?: WorkflowPlan;
};

/** Model-owned prose. Trusted runtime code owns the LaTeX target and PatchSet. */
export type TextDraft = {
  text: string;
  format: LatexDraftFormat;
  /** IDs must be a subset of trusted paper-search results when research is used. */
  sourceCandidateIds: string[];
};

/** Compatibility shape for the previous abstract-only helper/tests. */
export type WritingDraft = {
  kind: "abstract";
  text: string;
  sourceCandidateIds: string[];
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
  location?: { path?: string; text?: string };
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
  research?: ResearchReport;
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
  /** Stream tokens by default; set false only for callers that need a single JSON response. */
  stream?: boolean;
  onDelta?: (delta: string) => void;
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
  contextPackage: ContextPackage;
  services: WorkflowServices;
  /** Optional UI callback for incremental model tokens. */
  onDelta?: (delta: string) => void;
  /** Cancel in-flight model calls when the user switches project or leaves. */
  signal?: AbortSignal;
  /** Trusted output from the optional independent research stage. */
  research?: ResearchBundle;
};

export type WorkflowHandler = (
  input: WorkflowExecutionInput,
) => Promise<WorkflowResult>;

export function emptyAgentResult(
  workflow: WorkflowKind,
  summary: string,
  warnings: string[] = [],
): AgentResult {
  return { schemaVersion: "1", workflow, summary, warnings };
}

export type {
  LatexDraftFormat,
  LatexTargetSpec,
  ResearchBundle,
  ResearchReport,
  ResearchSpec,
};
