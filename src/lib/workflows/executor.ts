import { chatCompletions } from "../llmClient";
import { runResearchStage as runResearchService } from "../research/service";
import { runTool } from "../../tools/registry";
import { runAdviceWorkflow } from "./advice";
import { runCitationWorkflow } from "./citation";
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

function normalizedPlan(input: ExecuteWorkflowInput): WorkflowPlan {
  const primary = input.request.kind;
  const supplied = input.request.plan;
  const research = input.request.resolvedTask
    ? supplied?.research
    : supplied?.research ?? defaultResearch(primary);
  const target = supplied?.target ?? (
    input.request.selection && (primary === "writing" || primary === "polish")
      ? { kind: "selection" as const, createIfMissing: false }
      : undefined
  );
  const applyToLatex = primary === "advice" ? false : modifiesLatex(primary);
  const steps: WorkflowPlan["steps"] = primary === "research" || primary === "advice"
    ? [primary]
    : [
        ...(research ? ["research" as const] : []),
        primary,
        ...(applyToLatex && primary !== "review"
          ? ["latex-apply" as const]
          : []),
      ];

  return {
    primary,
    steps,
    ...(research ? { research } : {}),
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
  if ((expected === "review" || expected === "research" || expected === "advice") && result.agent.patch) {
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
  const request = { ...input.request, kind: plan.primary, plan };
  const baseInput: WorkflowExecutionInput = { ...input, request, services };
  const researchNotes: string[] = [];
  let research: WorkflowExecutionInput["research"];

  if (plan.research) {
    const researched = await runResearchService({
      spec: plan.research,
      userText: request.userText,
      ...(request.selectedText !== undefined
        ? { selectedText: request.selectedText }
        : input.ctx.selectedText !== undefined
          ? { selectedText: input.ctx.selectedText }
          : {}),
      ctx: input.ctx,
      runTool: services.runTool,
    });
    if (!researched.ok) {
      return rejectedResult(
        plan.primary,
        researched.message,
        [`research:error:${researched.code}`],
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
