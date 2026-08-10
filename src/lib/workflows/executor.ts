import { chatCompletions } from "../llmClient";
import { runResearchStage as runResearchService } from "../research/service";
import { runTool } from "../../tools/registry";
import { runAdviceWorkflow } from "./advice";
import { runCitationWorkflow } from "./citation";
import { locateCitationClaim } from "./citationClaim";
import { runCompileFixWorkflow } from "./compileFix";
import { runResearchWorkflow } from "./research";
import { runReviewWorkflow } from "./review";
import { runWritingWorkflow } from "./writing";
import {
  emptyAgentResult,
  type ResearchSpec,
  type WorkflowExecutionInput,
  type WorkflowHandler,
  type WorkflowKind,
  type WorkflowPlan,
  type WorkflowResult,
  type WorkflowServices,
} from "./types";

export type ExecuteWorkflowInput = Omit<WorkflowExecutionInput, "services" | "research">;

const HANDLERS: Record<WorkflowKind, WorkflowHandler> = {
  research: runResearchWorkflow,
  writing: runWritingWorkflow,
  polish: runWritingWorkflow,
  citation: runCitationWorkflow,
  latex: runWritingWorkflow,
  "compile-fix": runCompileFixWorkflow,
  review: runReviewWorkflow,
  advice: runAdviceWorkflow,
};

function buildServices(
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
): WorkflowServices {
  return {
    complete: (request) =>
      chatCompletions({
        ...request,
        stream: request.stream !== false,
        signal: request.signal ?? signal,
        ...(request.onDelta || onDelta
          ? { onDelta: request.onDelta ?? onDelta }
          : {}),
      }),
    runTool,
  };
}

function rejectedResult(
  kind: WorkflowKind,
  message: string,
  toolNotes: string[] = [],
): WorkflowResult {
  return {
    agent: emptyAgentResult(kind, "Workflow result failed runtime validation", [message]),
    content: message,
    toolNotes,
  };
}

function defaultResearch(kind: WorkflowKind): ResearchSpec | undefined {
  if (kind === "citation") {
    return { purpose: "citation", pageSize: 8, requireAbstract: false };
  }
  if (kind === "research") {
    return { purpose: "standalone", pageSize: 8, requireAbstract: false };
  }
  return undefined;
}

function modifiesLatex(kind: WorkflowKind): boolean {
  return (
    kind === "writing" ||
    kind === "polish" ||
    kind === "citation" ||
    kind === "latex" ||
    kind === "compile-fix"
  );
}

/** Reject illegal plan combinations before any model/tool work starts. */
export function validateWorkflowPlan(plan: WorkflowPlan): string | null {
  if (
    (plan.primary === "review" ||
      plan.primary === "research" ||
      plan.primary === "advice") &&
    plan.applyToLatex
  ) {
    return `${plan.primary} workflow must not apply LaTeX patches`;
  }
  if (
    (plan.primary === "review" ||
      plan.primary === "research" ||
      plan.primary === "advice") &&
    plan.steps.includes("latex-apply")
  ) {
    return `${plan.primary} plan must not include latex-apply`;
  }
  if (plan.primary === "citation" && !plan.research) {
    return "citation workflow requires a trusted research stage";
  }
  if (plan.primary === "citation" && !plan.steps.includes("research")) {
    return "citation plan must include research before judgement";
  }
  if (plan.primary === "advice" && plan.research) {
    return "advice workflow must not attach a research stage";
  }
  return null;
}

function normalizedPlan(input: ExecuteWorkflowInput): WorkflowPlan {
  const primary = input.request.kind;
  const supplied = input.request.plan;
  // advice: never research. review: only if the router attached it. others: plan or default.
  const resolvedResearch =
    primary === "advice"
      ? undefined
      : primary === "review"
        ? supplied?.research
        : supplied?.research ?? defaultResearch(primary);
  const target =
    primary === "advice" || primary === "research" || primary === "review"
      ? undefined
      : supplied?.target ?? (
          input.request.selection && (primary === "writing" || primary === "polish")
            ? { kind: "selection" as const, createIfMissing: false }
            : undefined
        );
  const applyToLatex = modifiesLatex(primary);
  const steps: WorkflowPlan["steps"] =
    primary === "research"
      ? ["research"]
      : primary === "advice"
        ? ["advice"]
        : [
            ...(resolvedResearch ? ["research" as const] : []),
            primary,
            ...(applyToLatex ? ["latex-apply" as const] : []),
          ];

  return {
    primary,
    steps,
    ...(resolvedResearch ? { research: resolvedResearch } : {}),
    ...(target ? { target } : {}),
    applyToLatex,
  };
}

/** Last safety gate before a workflow result reaches the UI. */
export function validateWorkflowResult(
  expected: WorkflowKind,
  result: WorkflowResult,
): WorkflowResult {
  if (result.agent.schemaVersion !== "1" || result.agent.workflow !== expected) {
    return rejectedResult(expected, `Workflow returned mismatched result metadata for ${expected}`);
  }
  if (
    (expected === "review" || expected === "research" || expected === "advice") &&
    result.agent.patch
  ) {
    return rejectedResult(expected, `${expected} workflow must never return a PatchSet`);
  }
  if (expected !== "review" && result.agent.review) {
    return rejectedResult(expected, `${expected} workflow returned an unexpected ReviewReport`);
  }
  if (expected !== "citation" && result.agent.citationPlan) {
    return rejectedResult(expected, `${expected} workflow returned an unexpected CitationPlan`);
  }
  if (expected !== "research" && result.agent.research) {
    return rejectedResult(expected, `${expected} workflow returned an unexpected ResearchReport`);
  }
  if (
    expected === "compile-fix" &&
    result.agent.patch &&
    result.agent.patch.verify?.compile !== true
  ) {
    return rejectedResult(expected, "Compile-fix PatchSet must require compile verification");
  }
  return result;
}

/**
 * Execute a fixed linear plan:
 * optional independent research -> one primary workflow -> runtime-owned LaTeX patch.
 */
export async function executeWorkflow(
  input: ExecuteWorkflowInput,
  services: WorkflowServices = buildServices(input.onDelta, input.signal),
): Promise<WorkflowResult> {
  const plan = normalizedPlan(input);
  const planError = validateWorkflowPlan(plan);
  if (planError) {
    return rejectedResult(plan.primary, planError, [`plan:rejected:${planError}`]);
  }
  let request = { ...input.request, kind: plan.primary, plan };
  let ctx = input.ctx;
  const researchNotes: string[] = [];
  let research: WorkflowExecutionInput["research"];

  // Citation without a selection: LLM points at a verbatim claim; runtime owns the range.
  const hasClaim =
    Boolean(request.selectedText?.trim()) || Boolean(ctx.selectedText?.trim());
  if (plan.primary === "citation" && !hasClaim) {
    const located = await locateCitationClaim({
      ctx,
      userText: request.userText,
      config: input.config,
      ...(plan.target ? { target: plan.target } : {}),
      complete: services.complete,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!located.ok) {
      return rejectedResult(plan.primary, located.message, [
        "citation-claim:error",
      ]);
    }
    ctx = {
      ...ctx,
      activeFile: located.claim.path,
      selectedText: located.claim.selectedText,
      selection: located.claim.selection,
    };
    request = {
      ...request,
      activeFile: located.claim.path,
      selectedText: located.claim.selectedText,
      selection: located.claim.selection,
    };
    researchNotes.push(
      `citation-claim:llm:${located.claim.path}:${located.claim.selection.start}-${located.claim.selection.end}`,
    );
  }

  const baseInput: WorkflowExecutionInput = { ...input, request, ctx, services };

  if (plan.research) {
    const researched = await runResearchService({
      spec: plan.research,
      userText: request.userText,
      ...(request.selectedText !== undefined
        ? { selectedText: request.selectedText }
        : ctx.selectedText !== undefined
          ? { selectedText: ctx.selectedText }
          : {}),
      ctx,
      runTool: services.runTool,
    });
    if (!researched.ok) {
      return rejectedResult(
        plan.primary,
        researched.message,
        [...researchNotes, `research:error:${researched.code}`],
      );
    }
    research = researched.bundle;
    researchNotes.push(`research:${research.purpose}:${research.hits.length}`);
  }

  const handler = HANDLERS[plan.primary];
  const result = await handler({
    ...baseInput,
    ...(research ? { research } : {}),
  });
  return validateWorkflowResult(plan.primary, {
    ...result,
    toolNotes: [...researchNotes, ...result.toolNotes],
  });
}

export function listWorkflows(): WorkflowKind[] {
  return Object.keys(HANDLERS) as WorkflowKind[];
}
